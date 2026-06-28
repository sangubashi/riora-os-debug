/**
 * csvImportPipeline.ts — CSV Import Management(画面⑥)の実体オーケストレーション
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4,6
 *   - docs/architecture/CSVImportSecurityArchitecture.md §3
 *
 * salonBoardDetailParser(パース・会計ID集約) → piiSanitizer(残存PII検査・会員番号ハッシュ化)
 * → staffResolver/customerMatcher/menuResolver(brain_staff/brain_customers/brain_menusとの突合)
 * の結果をUI契約(ValidationResult/ImportReport, src/components/admin/csv-import/types.ts)に変換する。
 *
 * このCSV形式(SalonBoard売上明細)には住所・生年月日列が存在しないため、
 * prefecture/city/ageGroupは常にnull(将来別形式の顧客マスタCSVに対応する場合に補完する)。
 *
 * menuResolverのフォールバック(role='imported_other')は
 * supabase/migrations/20260621_csv_import_fallback_menu_seed.sql 未適用の店舗では存在しないため、
 * その場合は完全一致(正規化・部分一致含む)しないメニューはすべてcheckout_integrity_error扱いになる。
 *
 * Pass C(名寄せ精度改善): menuResolver.resolveMenuId()の解決結果(exact_match/
 * normalized_match/partial_match/fallback_other/unresolved)はrawMenuNameごとに集計し、
 * ImportReport.menuResolutionおよびbrain_ops_logs.detail.menuResolutionへ記録する。
 *
 * Pass D(CSV Import完成): 品質レポート(qualityReport)をDry Run/Import実行の両方で
 * 算出する(csvImportQualityReport.ts・決定論ルール)。会員番号が無いCSVで同一氏名が
 * 複数回出現する場合の重複顧客リスクを可視化するが、customerMatcher.tsの既存方針
 * (自動マージしない・最終判断は運用者に委ねる)は変更していない。
 */
import type {
  ICustomerRepo, IVisitRepo, IStaffRepo, IMenuRepo, IStoreRepo, IOpsLogRepo,
} from '../../repositories/interfaces'
import type { Customer } from '../../types/riora.types'
import {
  parseSalonBoardDetailCsv, aggregateCheckouts,
  type SalonBoardCheckoutAggregate, type CheckoutIssue,
} from './salonBoardDetailParser'
import { sanitizeResidualPii, hashExternalKey } from './piiSanitizer'
import { buildStaffLookup, resolveStaffId, type StaffLookup } from './staffResolver'
import { buildMenuLookup, resolveMenuId, type MenuLookup } from './menuResolver'
import { findNameCandidates, decideCustomerMatch, type CustomerCandidate } from './customerMatcher'
import { recordMenuResolution, summarizeMenuResolution, computeCsvQualityReport } from './csvImportQualityReport'
import type {
  ValidationResult, SkipItem, ReviewItem, UnresolvedStaffName, PreviewRow,
  ImportReport, SkipReasonCode, ReviewDecisionValue,
  MenuResolutionLogEntry,
} from '../../components/admin/csv-import/types'

export interface PipelineRepos {
  customerRepo: ICustomerRepo
  visitRepo:    IVisitRepo
  staffRepo:    IStaffRepo
  menuRepo:     IMenuRepo
  storeRepo:    IStoreRepo
  opsLogRepo:   IOpsLogRepo
}

const FATAL_ISSUE_CODES = new Set(['empty_csv', 'missing_required_columns'])

function mapIssueToSkipReason(code: string): SkipReasonCode {
  switch (code) {
    case 'missing_field':       return 'missing_name'
    case 'unresolved_staff':    return 'unresolved_staff'
    default:                    return 'checkout_integrity_error'
  }
}

function dateOnly(visitDateTimeIso: string): string {
  return visitDateTimeIso.slice(0, 10)
}

interface ParsedAndAggregated {
  aggregates:     SalonBoardCheckoutAggregate[]
  skipped:        SkipItem[]
  unknownColumns: string[]
  droppedColumns: string[]
  totalRows:      number
  piiFoundTotal:  number
}

type ParseResult =
  | { ok: true; data: ParsedAndAggregated }
  | { ok: false; code: string; message: string }

/** パース→PII検査→会計ID集約までを行う(dry-run/import共通の前段)。書込は一切行わない。 */
function parseAndAggregate(csvText: string): ParseResult {
  const parsed = parseSalonBoardDetailCsv(csvText)
  const fatal = parsed.issues.find(i => FATAL_ISSUE_CODES.has(i.code))
  if (fatal) {
    return { ok: false, code: fatal.code, message: fatal.message }
  }

  let piiFoundTotal = 0
  const sanitizedRows = parsed.rows.map(row => {
    const { clean, piiFound } = sanitizeResidualPii(row)
    piiFoundTotal += piiFound
    return clean
  })

  const { aggregates, issues: aggIssues } = aggregateCheckouts(sanitizedRows)
  const allIssues: CheckoutIssue[] = [...parsed.issues, ...aggIssues]

  const skipped: SkipItem[] = allIssues
    .filter(i => i.severity === 'error')
    .map(i => i.lineNumber !== undefined
      ? { rowNumber: i.lineNumber, reasonCode: mapIssueToSkipReason(i.code) }
      : { checkoutId: i.checkoutId, reasonCode: mapIssueToSkipReason(i.code) })

  return {
    ok: true,
    data: {
      aggregates,
      skipped,
      unknownColumns: parsed.unknownColumns,
      droppedColumns: parsed.droppedColumns,
      totalRows: parsed.totalLines,
      piiFoundTotal,
    },
  }
}

interface ResolutionContext {
  staffLookup:       StaffLookup
  menuLookup:        MenuLookup
  existingCustomers: Customer[]
  byExternalHash:    Map<string, Customer>
  anonSalt:          string
}

async function buildResolutionContext(storeId: string, repos: PipelineRepos): Promise<ResolutionContext> {
  const [store, staff, menus, existingCustomers] = await Promise.all([
    repos.storeRepo.findById(storeId),
    repos.staffRepo.listByStore(storeId),
    repos.menuRepo.listByStore(storeId),
    repos.customerRepo.listByStore(storeId),
  ])

  if (!store) throw new Error(`store_not_found: ${storeId}`)

  const byExternalHash = new Map<string, Customer>()
  existingCustomers.forEach(c => { if (c.externalKeyHash) byExternalHash.set(c.externalKeyHash, c) })

  return {
    staffLookup: buildStaffLookup(staff.map(s => ({ id: s.id, name: s.name, nameAliases: s.nameAliases }))),
    menuLookup: buildMenuLookup(menus),
    existingCustomers,
    byExternalHash,
    anonSalt: store.anonSalt,
  }
}

/**
 * 会員番号(customerNumber)が空のCSV行は氏名一致のみでしかnameCandidatesを得られず、
 * 通常は常にneeds_review止まりになる。reviewDecisionsはリクエスト間で永続化されないため、
 * 同一CSVを再投入するとneeds_review→既定'new'により毎回重複顧客が作られてしまう。
 * これを防ぐため、候補の中に「この会計日付で既にimport済(salonboard_import/reconciled)の
 * visitを持つ候補」が一意に存在する場合は、その場で確定マッチとして扱う(再投入の冪等性)。
 */
async function findAlreadyImportedCandidate(
  candidates: CustomerCandidate[],
  visitDate: string,
  repos: PipelineRepos
): Promise<string | null> {
  const matches: string[] = []
  for (const c of candidates) {
    const existing = await repos.visitRepo.findByCustomerAndDate(c.customerId, visitDate)
    if (existing && (existing.source === 'salonboard_import' || existing.source === 'reconciled')) {
      matches.push(c.customerId)
    }
  }
  return matches.length === 1 ? matches[0] : null
}

async function matchCustomer(agg: SalonBoardCheckoutAggregate, ctx: ResolutionContext, repos: PipelineRepos) {
  const hash = agg.customerNumber ? hashExternalKey(agg.customerNumber, ctx.anonSalt) : null
  const matchedByHash = hash ? ctx.byExternalHash.get(hash) ?? null : null
  // 会員番号(external_key_hash)による確定一致かどうか(Pass D拡張・customerResolutionRateの算出に使用)。
  const isHashMatch = matchedByHash !== null
  const nameCandidates = matchedByHash ? [] : findNameCandidates(agg.customerName, ctx.existingCustomers)

  if (!matchedByHash && nameCandidates.length > 0) {
    const visitDate = dateOnly(agg.visitDateTime)

    // 既存importedビジット照合: 同一顧客が同日のvisitを持つ場合(同一CSV再取込の冪等化)
    const alreadyImportedId = await findAlreadyImportedCandidate(nameCandidates, visitDate, repos)
    if (alreadyImportedId) {
      return { hash, decision: { status: 'matched' as const, customerId: alreadyImportedId }, nameCandidates, isHashMatch }
    }

    // Pass N フォールバック③: 氏名 + 初回来店日
    // 会員番号(external_key_hash)が無い場合に候補が1件のみ存在し、かつその顧客の
    // 初回来店日がこの来店日以前であれば同一顧客への来店と判定してauto-matchする。
    // これにより (a)同一CSV内で同一人物が異なる日付で複数行ある場合、
    // (b)別CSVで同一人物の別日来店を取り込む場合、のどちらも重複顧客を生成しない。
    if (hash === null && nameCandidates.length === 1) {
      const sole = ctx.existingCustomers.find(c => c.id === nameCandidates[0].customerId)
      if (sole?.firstVisitDate != null && sole.firstVisitDate <= visitDate) {
        return { hash, decision: { status: 'matched' as const, customerId: sole.id }, nameCandidates, isHashMatch }
      }
    }
  }

  const decision = decideCustomerMatch({ matchedByHash, nameCandidates })
  return { hash, decision, nameCandidates, isHashMatch }
}

// ───────────────────────── Dry Run ─────────────────────────

export interface DryRunInput {
  storeId:  string
  fileName: string
  csvText:  string
}

export type DryRunResult =
  | { ok: true; result: ValidationResult }
  | { ok: false; code: string; message: string }

export async function buildDryRunResult(input: DryRunInput, repos: PipelineRepos): Promise<DryRunResult> {
  const parsed = parseAndAggregate(input.csvText)
  if (!parsed.ok) return parsed

  const ctx = await buildResolutionContext(input.storeId, repos)
  const { aggregates, skipped, unknownColumns, droppedColumns, totalRows, piiFoundTotal } = parsed.data

  const needsReview: ReviewItem[] = []
  const additionalSkipped: SkipItem[] = []
  const unresolvedStaffMap = new Map<string, UnresolvedStaffName>()
  const preview: PreviewRow[] = []
  let hashMatchedCount = 0

  for (const agg of aggregates) {
    const staffRes = resolveStaffId(agg.staffNameRaw, ctx.staffLookup)
    if (staffRes.status === 'unresolved') {
      const existing = unresolvedStaffMap.get(staffRes.normalized)
      if (existing) {
        existing.occurrenceCount += 1
      } else {
        unresolvedStaffMap.set(staffRes.normalized, {
          rawName: agg.staffNameRaw,
          normalized: staffRes.normalized,
          occurrenceCount: 1,
        })
      }
    }

    const menuRes = resolveMenuId(agg.menuName, ctx.menuLookup)
    if (menuRes.status === 'unresolved') {
      additionalSkipped.push({ rowNumber: agg.lineNumber, reasonCode: 'checkout_integrity_error' })
      continue
    }

    const { decision, isHashMatch } = await matchCustomer(agg, ctx, repos)
    if (isHashMatch) hashMatchedCount += 1
    if (decision.status === 'needs_review') {
      needsReview.push({
        rowNumber: agg.lineNumber,
        customerName: agg.customerName,
        candidateMatchName: decision.candidates[0].displayLabel,
      })
    }

    if (preview.length < 3) {
      const matchedExisting = decision.status === 'matched'
        ? ctx.existingCustomers.find(c => c.id === decision.customerId) ?? null
        : null
      preview.push({
        name: agg.customerName,
        gender: agg.gender || null,
        ageGroup: null,
        prefecture: null,
        city: null,
        firstVisitDate: matchedExisting?.firstVisitDate ?? dateOnly(agg.visitDateTime),
      })
    }
  }

  const allSkipped = [...skipped, ...additionalSkipped]
  const importable = Math.max(0, totalRows - allSkipped.length - needsReview.length)
  const unresolvedStaffCount = Array.from(unresolvedStaffMap.values())
    .reduce((sum, u) => sum + u.occurrenceCount, 0)
  const qualityReport = computeCsvQualityReport({
    aggregates, menuLookup: ctx.menuLookup, unresolvedStaffCount, needsReviewCount: needsReview.length,
    hashMatchedCount, parseLevelErrorCount: skipped.length, menuUnresolvedSkippedCount: additionalSkipped.length,
  })

  return {
    ok: true,
    result: {
      fileName: input.fileName,
      totalRows,
      importable,
      needsReview,
      skipped: allSkipped,
      unknownColumns,
      droppedColumns,
      piiFoundTotal,
      unresolvedStaff: Array.from(unresolvedStaffMap.values()),
      preview,
      qualityReport,
    },
  }
}

// ───────────────────────── Import実行 ─────────────────────────

export interface ImportInput {
  storeId:         string
  csvText:         string
  /** rowNumber(=checkoutの代表行番号)→'merge'|'new'。未指定行は'new'扱い。 */
  reviewDecisions: Record<number, ReviewDecisionValue>
}

export type ImportResult =
  | { ok: true; report: ImportReport }
  | { ok: false; code: string; message: string }

export async function runImportPipeline(input: ImportInput, repos: PipelineRepos): Promise<ImportResult> {
  const startedAt = Date.now()
  const parsed = parseAndAggregate(input.csvText)
  if (!parsed.ok) return parsed

  const ctx = await buildResolutionContext(input.storeId, repos)
  const { aggregates, skipped, piiFoundTotal } = parsed.data

  let newCustomers = 0
  let updatedCustomers = 0
  let visitsImported = 0
  let unresolvedStaffCount = 0
  let needsReviewCount = 0
  let hashMatchedCount = 0
  let menuUnresolvedSkippedCount = 0
  const visitCountCache = new Map<string, number>()
  const menuResolutionByRawName = new Map<string, MenuResolutionLogEntry>()

  for (const agg of aggregates) {
    const staffRes = resolveStaffId(agg.staffNameRaw, ctx.staffLookup)
    if (staffRes.status === 'unresolved') {
      unresolvedStaffCount += 1
      continue // allStaffResolvedゲートで通常発生しない(競合時のみ)
    }

    const menuRes = resolveMenuId(agg.menuName, ctx.menuLookup)
    recordMenuResolution(agg.menuName, menuRes, menuResolutionByRawName)
    if (menuRes.status === 'unresolved') {
      menuUnresolvedSkippedCount += 1
      continue
    }

    const { hash, decision, isHashMatch } = await matchCustomer(agg, ctx, repos)
    if (isHashMatch) hashMatchedCount += 1
    let customerId: string

    if (decision.status === 'matched') {
      customerId = decision.customerId
      updatedCustomers += 1
    } else if (decision.status === 'needs_review') {
      needsReviewCount += 1
      const choice = input.reviewDecisions[agg.lineNumber] ?? 'new'
      if (choice === 'merge') {
        customerId = decision.candidates[0].customerId
        updatedCustomers += 1
      } else {
        const created = await repos.customerRepo.create({
          storeId: input.storeId,
          name: agg.customerName,
          ageGroup: null,
          firstVisitDate: dateOnly(agg.visitDateTime),
          prefecture: null,
          city: null,
          externalKeyHash: hash,
        })
        ctx.existingCustomers.push(created)
        if (hash) ctx.byExternalHash.set(hash, created)
        customerId = created.id
        newCustomers += 1
      }
    } else {
      const created = await repos.customerRepo.create({
        storeId: input.storeId,
        name: agg.customerName,
        ageGroup: null,
        firstVisitDate: dateOnly(agg.visitDateTime),
        prefecture: null,
        city: null,
        externalKeyHash: hash,
      })
      ctx.existingCustomers.push(created)
      if (hash) ctx.byExternalHash.set(hash, created)
      customerId = created.id
      newCustomers += 1
    }

    const visitDate = dateOnly(agg.visitDateTime)
    const existingVisit = await repos.visitRepo.findByCustomerAndDate(customerId, visitDate)

    if (existingVisit && existingVisit.source !== 'reconciled' && existingVisit.source !== 'salonboard_import') {
      await repos.visitRepo.reconcile(existingVisit.id, {
        staffId: staffRes.staffId,
        menuId: menuRes.menuId,
        isNomination: agg.isDesignated,
        treatmentAmount: agg.netServiceSales,
        retailAmount: agg.retailSales,
      })
      visitsImported += 1
    } else if (!existingVisit) {
      const visitCountAt = visitCountCache.get(customerId)
        ?? await repos.visitRepo.countByCustomer(customerId)
      visitCountCache.set(customerId, visitCountAt + 1)

      await repos.visitRepo.create({
        storeId: input.storeId,
        customerId,
        staffId: staffRes.staffId,
        menuId: menuRes.menuId,
        visitDate,
        visitCountAt: visitCountAt + 1,
        isNomination: agg.isDesignated,
        treatmentAmount: agg.netServiceSales,
        retailAmount: agg.retailSales,
        retailCategory: agg.retailNames.length > 0 ? agg.retailNames.join('/') : null,
        homecarePurchased: agg.retailSales > 0,
        homecareDeclined: false,
        nextBookingMade: false,
        noBookingReason: null,
        voiceMemoUrl: null,
        visitScore: 0,
        source: 'salonboard_import',
      })
      visitsImported += 1
    }
    // 既存visitが既にreconciled/salonboard_import済み → 同一CSV再取込の冪等スキップ(増分ゼロ)
  }

  const durationMs = Date.now() - startedAt
  const menuResolution = summarizeMenuResolution(menuResolutionByRawName)
  // qualityReport.menuResolutionはaggregates全件から再算出するため値はmenuResolutionと一致する
  // (本ループはstaffRes.unresolvedの行をcontinueでスキップしているが、品質レポートは
  // 「未解決スタッフによりスキップされた行が何件あるか」自体を可視化する目的のため全件対象にする)。
  const qualityReport = computeCsvQualityReport({
    aggregates, menuLookup: ctx.menuLookup, unresolvedStaffCount, needsReviewCount,
    hashMatchedCount, parseLevelErrorCount: skipped.length, menuUnresolvedSkippedCount,
  })

  await repos.opsLogRepo.insert({
    storeId: input.storeId,
    kind: 'csv_import',
    actorId: null,
    // menuResolution.entries(rawMenuName/resolvedMenuName)は施術メニュー名であり個人情報では
    // ないため記録してよい(PII方針はお客様氏名・連絡先等が対象。CSVImportSecurityArchitecture.md参照)。
    // qualityReport.duplicateCustomerNamesは氏名を含むため要注意だが、ops_logs(brain_ops_logs)は
    // 元々owner専用APIのみが読む内部ログであり、CSVImportSecurityArchitecture.mdのPII方針は
    // 「外部送信・画面外への漏出」を主眼とするため、取込結果の監査情報として保持する。
    detail: { newCustomers, updatedCustomers, visitsImported, piiFoundTotal, unresolvedStaffCount, durationMs, menuResolution, qualityReport },
  })

  return {
    ok: true,
    report: { newCustomers, updatedCustomers, visitsImported, piiFoundTotal, failedChunks: 0, durationMs, menuResolution, unresolvedStaffCount, qualityReport },
  }
}

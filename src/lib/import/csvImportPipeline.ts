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
  IBriefingRepo, IOutcomeRepo, IStatsRepo,
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
import { recordProposalOutcome } from '../proposal/recordProposalOutcome'
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
  briefingRepo: IBriefingRepo
  outcomeRepo:  IOutcomeRepo
  statsRepo:    IStatsRepo
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

/**
 * PHASE 1-Db: subscription実行結果判定用のキーワード検出(recordProposalOutcome.tsの
 * hasSubscriptionKeywordに渡す)。brain_menus.roleにサブスクを表す値が存在しないため
 * (Phase 1-C調査で確認済み)、CSV会計明細の生テキスト(menuName/serviceNames/
 * retailNames)への単純な部分一致で判定する。表記ゆれ(定期便・月額等)は拾えない
 * 既知の制約。
 */
function hasSubscriptionKeyword(agg: SalonBoardCheckoutAggregate): boolean {
  const KEYWORD = 'サブスク'
  if (agg.menuName.includes(KEYWORD)) return true
  if (agg.serviceNames.some((name) => name.includes(KEYWORD))) return true
  if (agg.retailNames.some((name) => name.includes(KEYWORD))) return true
  return false
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

export interface ResolutionContext {
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

/** 案A(来店日近傍)で「拮抗している」とみなす閾値(日数)。この差未満なら不確実として自動統合しない。 */
const VISIT_PROXIMITY_MARGIN_DAYS = 3

/**
 * 単一候補ケース(案C追加ガード・docs/PASS_AC_GAP_GUARD_OPTIONS_AUDIT.md §4.3準拠)。
 * candidateのvisit実績がSINGLE_CANDIDATE_MIN_VISITS_FOR_UNLIMITED件未満、かつ最終来店日
 * からのギャップがSINGLE_CANDIDATE_GAP_LIMIT_DAYSを超える場合は自動統合せずneeds_review
 * へ落とす(実績の浅い候補への誤統合リスクを下げるため)。visit実績が閾値以上の候補は
 * ギャップ無制限のまま(現状維持)。
 */
const SINGLE_CANDIDATE_MIN_VISITS_FOR_UNLIMITED = 3
const SINGLE_CANDIDATE_GAP_LIMIT_DAYS = 90

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.abs(da - db) / 86_400_000
}

export type VisitProximityMethod = 'visit_proximity_single' | 'visit_proximity_closest'

/**
 * Pass A+C(重複生成停止フェーズ・docs/DUPLICATE_PREVENTION_IMPLEMENTATION_PLAN.md準拠)。
 *
 * 会員番号が無く氏名一致候補が2件以上あるケースは、既存のPass N(直上の単一候補
 * フォールバック)が構造的に機能しない(候補が2件以上になった瞬間、その氏名の顧客は
 * 以降ずっとneeds_review→既定'new'に落ち続け、来店のたびに新規顧客が量産される
 * カスケードバグが起きる。docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md §2.2参照)。
 *
 * これを埋めるため、以下の条件を満たす場合のみ確定マッチとする(自動統合対象は
 * 「完全氏名一致(findNameCandidatesで既に保証済み)+来店日非衝突+visit実績あり」の
 * みに限定し、不確実なものはnullを返してneeds_review(自動統合しない)に委ねる):
 *
 *   1. 候補のいずれかが今回と同日のvisitを既に持つ場合 → 衝突とみなしnull
 *      (同日一致による確定マッチはfindAlreadyImportedCandidateの役割であり、
 *      ここでは扱わない。安全側に倒しnullを返す)
 *   2. 候補をvisit実績(直近1件)が存在するものだけに絞り込む(案C: 過去visit存在)。
 *      表記ゆれ由来のスタブ(visit=0の重複候補、AUDIT_V1で確認したパターンA)は
 *      この時点で除外される
 *   3a. 絞り込んだ結果が1件のみ → 確定マッチ(visit_proximity_single)。ただし
 *       候補のvisit実績が3件未満かつギャップが90日超の場合は、実績が浅い候補への
 *       誤統合リスクを下げるため`status: 'declined'`を返しneeds_reviewへ委ねる
 *       (PASS_AC_GAP_GUARD_OPTIONS_AUDIT.md §4.3のC案)
 *   3b. 絞り込んだ結果が2件以上 → 来店日ギャップ(案A: 来店日近傍)が最小の候補を
 *       採用する(visit_proximity_closest)。ただし次点候補とのギャップ差が
 *       VISIT_PROXIMITY_MARGIN_DAYS未満(僅差)の場合は誤統合リスクが高いとみなし
 *       `status: 'declined'`を返す
 *
 * 戻り値は3値(matched/no_visit_history/declined)を区別する。`no_visit_history`
 * (候補が1件もvisit実績を持たない)場合のみ、呼び出し側は旧Pass N(firstVisitDateベース)
 * へフォールバックしてよい。`declined`(visit実績はあるがガード/僅差判定で見送った)場合は
 * 旧Pass Nへは絶対にフォールバックしない — visit実績がある候補に対して意図的に
 * needs_reviewへ倒した判断を、日付方向のみで無条件マッチする旧Pass Nが上書きしてしまうと
 * C案ガードの効果が実質的に無効化されるため(実データ検証で確認した既知の抜け穴)。
 */
async function resolveByVisitProximity(
  candidates: CustomerCandidate[],
  visitDate: string,
  repos: PipelineRepos
): Promise<
  | { status: 'matched'; customerId: string; method: VisitProximityMethod }
  | { status: 'no_visit_history' }
  | { status: 'declined' }
> {
  const withVisits: { customerId: string; lastVisitDate: string }[] = []
  for (const c of candidates) {
    const recent = await repos.visitRepo.recentByCustomer(c.customerId, 1)
    if (recent.length === 0) continue
    if (recent[0].visitDate === visitDate) return { status: 'declined' }
    withVisits.push({ customerId: c.customerId, lastVisitDate: recent[0].visitDate })
  }

  if (withVisits.length === 0) return { status: 'no_visit_history' }
  if (withVisits.length === 1) {
    const sole = withVisits[0]
    const gapDays = daysBetween(sole.lastVisitDate, visitDate)
    if (gapDays > SINGLE_CANDIDATE_GAP_LIMIT_DAYS) {
      const visitCount = await repos.visitRepo.countByCustomer(sole.customerId)
      if (visitCount < SINGLE_CANDIDATE_MIN_VISITS_FOR_UNLIMITED) {
        return { status: 'declined' }
      }
    }
    return { status: 'matched', customerId: sole.customerId, method: 'visit_proximity_single' }
  }

  const withGap = withVisits
    .map(w => ({ ...w, gapDays: daysBetween(w.lastVisitDate, visitDate) }))
    .sort((a, b) => a.gapDays - b.gapDays)
  const [best, second] = withGap
  if (second && (second.gapDays - best.gapDays) < VISIT_PROXIMITY_MARGIN_DAYS) {
    return { status: 'declined' }
  }
  return { status: 'matched', customerId: best.customerId, method: 'visit_proximity_closest' }
}

export type CustomerMatchMethod =
  | 'hash' | 'idempotent_same_day' | 'pass_n_single_candidate'
  | 'stub_zero_visit_single_candidate' | VisitProximityMethod | null

/** Before/After実測(docs/DUPLICATE_PREVENTION_IMPLEMENTATION_PLAN.md実装検証)のため公開する。 */
export async function matchCustomer(agg: SalonBoardCheckoutAggregate, ctx: ResolutionContext, repos: PipelineRepos) {
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
      return {
        hash, decision: { status: 'matched' as const, customerId: alreadyImportedId },
        nameCandidates, isHashMatch, matchMethod: 'idempotent_same_day' as CustomerMatchMethod, proximityDeclined: false,
      }
    }

    // Pass A+C(重複生成停止フェーズ・docs/DUPLICATE_PREVENTION_IMPLEMENTATION_PLAN.md準拠)。
    // 候補が1件でも複数件でも、まずこちらを優先して試す。
    //
    // 実データ検証(小林絵里等の再現テスト)で判明した通り、旧Pass N(直下)は
    // 「候補のfirstVisitDate <= 今回のvisitDate」という一方向の日付比較のため、
    // CSV行の並び順が来店日の昇順になっていない場合(会計ID順等、実データで確認済み)、
    // 候補が1件しか無い場合でも新しい行の来店日が既存候補の初回来店日より「前」だと
    // マッチに失敗し、needs_review→既定'new'で重複が生成される。これが実際の
    // 重複発生の主要因だった(CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md時点では
    // 候補複数件のケースのみを主要因と推定していたが、実データの created_at 順序を
    // 検証した結果、候補1件の日付逆転ケースも実際に発生していたことを確認した)。
    // resolveByVisitProximityは日付の前後を問わない対称な近傍判定のため、この
    // ケースも含めて解決できる。
    let proximityDeclined = false
    let allowLegacyPassNFallback = true
    if (hash === null && nameCandidates.length >= 1) {
      const resolved = await resolveByVisitProximity(nameCandidates, visitDate, repos)
      if (resolved.status === 'matched') {
        return {
          hash, decision: { status: 'matched' as const, customerId: resolved.customerId },
          nameCandidates, isHashMatch, matchMethod: resolved.method as CustomerMatchMethod, proximityDeclined: false,
        }
      }
      // resolveByVisitProximityが確定できなかった場合をDry Run表示強化(proximity_review_
      // count)のために記録する。ただし旧Pass Nへのフォールバック可否は理由によって分ける:
      // 'no_visit_history'(候補がvisit実績を1件も持たない)場合のみフォールバックを許可し、
      // 'declined'(visit実績はあるがガード/僅差判定で意図的に見送った)場合はフォールバック
      // しない。ここでフォールバックを許してしまうと、旧Pass N(firstVisitDateの方向のみ見て
      // 日数無制限でマッチする)がC案ガードの判断を無条件に上書きしてしまい、ガードを追加した
      // 意味が失われる(実装検証で確認済みの抜け穴)。
      proximityDeclined = true
      allowLegacyPassNFallback = resolved.status === 'no_visit_history'
    }

    // Pass N フォールバック③(旧ロジック・氏名 + 初回来店日): 候補にvisit実績が無く
    // (brain_visitsが1件も無い)Pass A+Cが判定不能だったが、customer.firstVisitDate
    // 自体は設定されている候補が1件だけ存在する場合の最終フォールバックとして残す。
    //
    // firstVisitDateがnullの候補(予約CSV取込が作るスタブ顧客。会計未了のため
    // firstVisitDateが一度も設定されない)は、この時点で既に allowLegacyPassNFallback
    // (resolveByVisitProximityの'no_visit_history'判定)によって「候補1件・visit実績0件」
    // であることが確定済みのため、日付比較する対象(過去のvisit)自体が存在しない。
    // よってfirstVisitDate===nullの場合は日付条件を課さずそのまま確定マッチとする
    // (docs/CUSTOMER_DUPLICATE_ROOT_CAUSE.md参照。予約CSVスタブ×売上CSVの
    // クロスパイプライン重複の再発防止)。
    if (hash === null && nameCandidates.length === 1 && allowLegacyPassNFallback) {
      const sole = ctx.existingCustomers.find(c => c.id === nameCandidates[0].customerId)
      if (sole && (sole.firstVisitDate == null || sole.firstVisitDate <= visitDate)) {
        const matchMethod: CustomerMatchMethod =
          sole.firstVisitDate == null ? 'stub_zero_visit_single_candidate' : 'pass_n_single_candidate'
        return {
          hash, decision: { status: 'matched' as const, customerId: sole.id },
          nameCandidates, isHashMatch, matchMethod, proximityDeclined,
        }
      }
    }

    const decision = decideCustomerMatch({ matchedByHash, nameCandidates })
    return { hash, decision, nameCandidates, isHashMatch, matchMethod: (isHashMatch ? 'hash' : null) as CustomerMatchMethod, proximityDeclined }
  }

  const decision = decideCustomerMatch({ matchedByHash, nameCandidates })
  return { hash, decision, nameCandidates, isHashMatch, matchMethod: (isHashMatch ? 'hash' : null) as CustomerMatchMethod, proximityDeclined: false }
}

// ───────────────────────── Dry Run ─────────────────────────

export interface DryRunInput {
  storeId:  string
  fileName: string
  csvText:  string
  /** 自動判定済みCSV形式。未指定時は 'unknown' とみなす。 */
  csvType?: 'detail' | 'reservation' | 'unknown'
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
  let nameProximityMatchedCount = 0
  let visitProximityClosestCount = 0
  let proximityReviewCount = 0

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

    const { decision, isHashMatch, matchMethod, proximityDeclined } = await matchCustomer(agg, ctx, repos)
    if (isHashMatch) hashMatchedCount += 1
    if (matchMethod === 'visit_proximity_single' || matchMethod === 'visit_proximity_closest') {
      nameProximityMatchedCount += 1
    }
    if (matchMethod === 'visit_proximity_closest') visitProximityClosestCount += 1
    if (proximityDeclined) proximityReviewCount += 1
    if (decision.status === 'needs_review') {
      needsReview.push({
        rowNumber: agg.lineNumber,
        customerName: agg.customerName,
        candidateMatchName: decision.candidates[0].displayLabel,
      })
    }

    if (preview.length < 10) {
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
    hashMatchedCount, nameProximityMatchedCount, visitProximityClosestCount, proximityReviewCount,
    parseLevelErrorCount: skipped.length, menuUnresolvedSkippedCount: additionalSkipped.length,
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
      csvType: input.csvType ?? 'unknown' as const,
      csvInfoMessage: null,
    },
  }
}

// ───────────────────────── Import実行 ─────────────────────────

export interface ImportInput {
  storeId:         string
  /** 監査ログ記録用ファイル名(PII含まない)。省略時は空文字列を記録する。 */
  fileName?:       string
  csvText:         string
  /** 自動判定済みCSV形式(監査ログ記録用)。 */
  csvType?:        string
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
  let nameProximityMatchedCount = 0
  let visitProximityClosestCount = 0
  let proximityReviewCount = 0
  let stubZeroVisitMatchedCount = 0
  let menuUnresolvedSkippedCount = 0
  // PHASE 1-Cc: この取込でbrain_proposal_outcomesへ実際に書き込まれた件数。
  // 1件以上ある場合のみ、ループ完了後にbrain_pattern_step_statsを1回だけrefreshする。
  let proposalOutcomesRecorded = 0
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

    const { hash, decision, isHashMatch, matchMethod, proximityDeclined } = await matchCustomer(agg, ctx, repos)
    if (isHashMatch) hashMatchedCount += 1
    if (matchMethod === 'visit_proximity_single' || matchMethod === 'visit_proximity_closest') {
      nameProximityMatchedCount += 1
    }
    if (matchMethod === 'visit_proximity_closest') visitProximityClosestCount += 1
    if (matchMethod === 'stub_zero_visit_single_candidate') stubZeroVisitMatchedCount += 1
    if (proximityDeclined) proximityReviewCount += 1
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
      const reconciledVisit = await repos.visitRepo.reconcile(existingVisit.id, {
        staffId: staffRes.staffId,
        menuId: menuRes.menuId,
        isNomination: agg.isDesignated,
        // 施術行はあるが割引額が施術売上を上回る会計はnetServiceSalesが負になりうる
        // (brain_visits.treatment_amount>=0制約に違反しinsert/reconcileが例外を投げる)。
        // 0未満は0にクランプする(TREATMENT_AMOUNT_NEGATIVE_FIX_1)。
        treatmentAmount: Math.max(0, agg.netServiceSales),
        retailAmount: agg.retailSales,
      })
      visitsImported += 1

      // PHASE 1-Bc: 会計確定(reconcile)直後にfire_logを逆引きしbrain_proposal_outcomes
      // へ記録を試みる(Phase 1-Aと同じnon-fatalパターン。失敗してもCSV取込自体は成功扱い)。
      try {
        const outcomeResult = await recordProposalOutcome(
          {
            storeId: input.storeId, visit: reconciledVisit,
            hasOptionPurchase: agg.optionNames.length > 0,
            hasSubscriptionKeyword: hasSubscriptionKeyword(agg),
          },
          repos
        )
        if (outcomeResult.recorded) proposalOutcomesRecorded += 1
      } catch (e) {
        console.warn('[proposal-outcome] record failed (non-fatal):', e)
      }
    } else if (!existingVisit) {
      const createdVisit = await repos.visitRepo.createSequenced({
        storeId: input.storeId,
        customerId,
        staffId: staffRes.staffId,
        menuId: menuRes.menuId,
        visitDate,
        isNomination: agg.isDesignated,
        // reconcile()側と同じ理由でクランプする(TREATMENT_AMOUNT_NEGATIVE_FIX_1)。
        treatmentAmount: Math.max(0, agg.netServiceSales),
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

      // PHASE 1-Bc: 新規visit作成直後にも同様にoutcomes記録を試みる(non-fatal)。
      try {
        const outcomeResult = await recordProposalOutcome(
          {
            storeId: input.storeId, visit: createdVisit,
            hasOptionPurchase: agg.optionNames.length > 0,
            hasSubscriptionKeyword: hasSubscriptionKeyword(agg),
          },
          repos
        )
        if (outcomeResult.recorded) proposalOutcomesRecorded += 1
      } catch (e) {
        console.warn('[proposal-outcome] record failed (non-fatal):', e)
      }
    }
    // 既存visitが既にreconciled/salonboard_import済み → 同一CSV再取込の冪等スキップ(増分ゼロ)
  }

  // PHASE 1-Cc: この取込でoutcomeが1件以上記録された場合のみ、brain_pattern_step_stats
  // (マテビュー)を1回だけrefreshする(取込中に毎回refreshすると冗長なため、ループ完了後に
  // 1回にまとめる)。Phase 1-A/Bcと同じnon-fatalパターンで、失敗してもCSV取込は成功扱い。
  if (proposalOutcomesRecorded > 0) {
    try {
      await repos.statsRepo.refreshStepStats()
    } catch (e) {
      console.warn('[proposal-outcome] pattern_step_stats refresh failed (non-fatal):', e)
    }
  }

  const durationMs = Date.now() - startedAt
  const menuResolution = summarizeMenuResolution(menuResolutionByRawName)
  // qualityReport.menuResolutionはaggregates全件から再算出するため値はmenuResolutionと一致する
  // (本ループはstaffRes.unresolvedの行をcontinueでスキップしているが、品質レポートは
  // 「未解決スタッフによりスキップされた行が何件あるか」自体を可視化する目的のため全件対象にする)。
  const qualityReport = computeCsvQualityReport({
    aggregates, menuLookup: ctx.menuLookup, unresolvedStaffCount, needsReviewCount,
    hashMatchedCount, nameProximityMatchedCount, visitProximityClosestCount, proximityReviewCount,
    parseLevelErrorCount: skipped.length, menuUnresolvedSkippedCount,
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
    detail: {
      fileName: input.fileName ?? '',
      rows: parsed.data.totalRows,
      type: input.csvType ?? 'detail',
      newCustomers, updatedCustomers, visitsImported, piiFoundTotal, unresolvedStaffCount, durationMs, menuResolution, qualityReport,
      // Pass A+C監査ログ(docs/PASS_AC_FINAL_GO_NOGO_AUDIT.md §④監視項目対応)。
      // visit_proximity_closest(複数候補タイブレーク)は実データ検証時点で発動0件だった
      // ため、本番初回運用でこのreasonが何件記録されるかを事後確認できるようにする。
      proximityAudit: {
        reason: 'visit_proximity_closest',
        visitProximityClosestCount,
        proximityReviewCount,
      },
      // stub_zero_visit_single_candidate監査ログ(docs/CUSTOMER_DUPLICATE_ROOT_CAUSE.md
      // 再発防止策)。予約CSV由来のスタブ(visit実績0件・firstVisitDate=null)を
      // 売上明細CSV側で確定マッチできた件数を事後確認できるようにする。
      stubResolutionAudit: {
        reason: 'stub_zero_visit_single_candidate',
        stubZeroVisitMatchedCount,
      },
    },
  })

  return {
    ok: true,
    report: { newCustomers, updatedCustomers, visitsImported, piiFoundTotal, failedChunks: 0, durationMs, menuResolution, unresolvedStaffCount, qualityReport },
  }
}

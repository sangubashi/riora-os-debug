/**
 * reservationImportPipeline.ts — 予約CSV Dry Run/Import オーケストレーション(RES-5・RES-8)
 *
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md(RES-2)・RES-3確定事項・
 *   docs/design/RESERVATION_IMPORT_IMPLEMENTATION_PLAN_V1.md §5/§6/§7・RES-8顧客名寄せ改善
 *
 * 既存csvImportPipeline.ts(売上明細CSV)とは完全に独立させる。共有するのは
 * staffResolver.ts(変更なしで再利用)・customerMatcher.tsの`findNameCandidates`
 * (候補探索のみの純粋関数・再利用)だけであり、`decideCustomerMatch`(判定ポリシー)は
 * 意図的に再利用しない。
 *
 * RES-8: `decideCustomerMatch`は「氏名一致が1件でもneeds_review」という売上明細CSV向けの
 * 保守的なポリシーであり、既にcsvImportPipeline.ts(本番稼働中)が依存している。予約CSVの
 * needsReview過多問題(RES-7実測: 6月CSVで92件中91件)を解消するため、予約Import専用の
 * 判定ポリシー(`decideReservationCustomerMatch`、氏名完全一致1件のみなら自動紐付け)を
 * このファイル内に新設する。`customerMatcher.ts`自体は変更しないため、既存の売上明細CSV
 * Import(csvImportPipeline.ts)の挙動には一切影響しない。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICustomerRepo, IStaffRepo, IReservationRepo, IOpsLogRepo, ReservationUpsertInput } from '../../repositories/interfaces'
import { parseReservationCsv, toIsoJst, mapIsFirstVisit, type ReservationCsvRow } from './reservationCsvParser'
import { mapReservationStatus } from './reservationStatusMapper'
import { buildStaffLookup, resolveStaffId } from './staffResolver'
import { findNameCandidates, type CustomerCandidate } from './customerMatcher'
import type {
  ReservationValidationResult, ReservationPreviewRow, ReservationSkipItem,
  ReservationNeedsReviewItem, ReservationImportReport,
} from '../../components/admin/csv-import/types'

/**
 * 予約Import専用の顧客名寄せ判定(RES-8)。
 *   候補0件   → new(新規作成)
 *   候補1件   → matched(自動紐付け・needsReviewへ送らない)
 *   候補2件以上 → needs_review(同姓同名の可能性があるため運用者確認)
 */
export type ReservationCustomerDecision =
  | { status: 'matched'; customerId: string }
  | { status: 'needs_review'; candidates: CustomerCandidate[] }
  | { status: 'new' }

export function decideReservationCustomerMatch(candidates: CustomerCandidate[]): ReservationCustomerDecision {
  if (candidates.length === 0) return { status: 'new' }
  if (candidates.length === 1) return { status: 'matched', customerId: candidates[0].customerId }
  return { status: 'needs_review', candidates }
}

export interface ReservationPipelineRepos {
  customerRepo:     ICustomerRepo
  staffRepo:        IStaffRepo
  reservationRepo:  IReservationRepo
  opsLogRepo:       IOpsLogRepo
}

const FATAL_ISSUE_CODES = new Set(['empty_csv', 'missing_required_columns'])

function formatVisitDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

function formatTime(hhmm: string): string {
  if (!/^\d{3,4}$/.test(hhmm)) return ''
  const padded = hhmm.padStart(4, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`
}

/**
 * brain_staff.id → user_id(=profiles.id)のマッピングを取得する(RES-3確定フロー)。
 * IStaffRepo/Staff型はuser_idを持たないため、この専用パイプラインでのみ直接クエリする
 * (app/lib/repos.tsのgetServiceClient()と同じ「一時的なクロススキーマ参照」方針を踏襲)。
 */
async function buildStaffProfileMap(supabase: SupabaseClient, storeId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('brain_staff')
    .select('id, user_id')
    .eq('store_id', storeId)
    .is('deleted_at', null)

  if (error) throw new Error(`brain_staff.user_id取得失敗: ${error.message}`)

  const map = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ id: string; user_id: string | null }>) {
    if (row.user_id) map.set(row.id, row.user_id)
  }
  return map
}

interface ResolveContext {
  staffLookup: ReturnType<typeof buildStaffLookup>
  profileMap:  Map<string, string>
  customers:   Awaited<ReturnType<ICustomerRepo['listByStore']>>
}

async function buildResolveContext(
  storeId: string, repos: ReservationPipelineRepos, supabase: SupabaseClient
): Promise<ResolveContext> {
  const [staffList, customers, profileMap] = await Promise.all([
    repos.staffRepo.listByStore(storeId),
    repos.customerRepo.listByStore(storeId),
    buildStaffProfileMap(supabase, storeId),
  ])
  const staffLookup = buildStaffLookup(staffList.map(s => ({ id: s.id, name: s.name, nameAliases: s.nameAliases })))
  return { staffLookup, profileMap, customers }
}

/** 1行を解決する。unresolvedの場合はreasonCodeを返す。 */
function resolveRow(row: ReservationCsvRow, ctx: ResolveContext): {
  ok: true
  scheduledAt: string
  status: 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  profileId: string
  nameCandidates: ReturnType<typeof findNameCandidates>
} | {
  ok: false
  reasonCode: 'unresolved_staff' | 'unresolved_status' | 'invalid_datetime'
} {
  const scheduledAt = toIsoJst(row.visitDate, row.startTime)
  if (!scheduledAt) return { ok: false, reasonCode: 'invalid_datetime' }

  const statusRes = mapReservationStatus(row.statusRaw)
  if (statusRes.status === 'unresolved') return { ok: false, reasonCode: 'unresolved_status' }

  const staffRes = resolveStaffId(row.staffNameRaw, ctx.staffLookup)
  if (staffRes.status === 'unresolved') return { ok: false, reasonCode: 'unresolved_staff' }

  const profileId = ctx.profileMap.get(staffRes.staffId)
  if (!profileId) return { ok: false, reasonCode: 'unresolved_staff' }

  const nameCandidates = findNameCandidates(row.customerName, ctx.customers)
  return { ok: true, scheduledAt, status: statusRes.value, profileId, nameCandidates }
}

// ───────────────────────── Dry Run ─────────────────────────

export interface ReservationDryRunInput {
  storeId:  string
  fileName: string
  csvText:  string
}

export type ReservationDryRunResult =
  | { ok: true; result: ReservationValidationResult }
  | { ok: false; code: string; message: string }

export async function buildReservationDryRunResult(
  input: ReservationDryRunInput, repos: ReservationPipelineRepos, supabase: SupabaseClient
): Promise<ReservationDryRunResult> {
  const parsed = parseReservationCsv(input.csvText)
  const fatal = parsed.issues.find(i => FATAL_ISSUE_CODES.has(i.code))
  if (fatal) return { ok: false, code: fatal.code, message: fatal.message }

  const ctx = await buildResolveContext(input.storeId, repos, supabase)

  const skipped: ReservationSkipItem[] = parsed.issues
    .filter(i => i.lineNumber !== undefined)
    .map(i => ({ rowNumber: i.lineNumber as number, reasonCode: 'missing_field' }))
  const needsReview: ReservationNeedsReviewItem[] = []
  const unresolvedStaffMap = new Map<string, { rawName: string; normalized: string; occurrenceCount: number }>()
  const preview: ReservationPreviewRow[] = []

  for (const row of parsed.rows) {
    const resolved = resolveRow(row, ctx)

    if (!resolved.ok) {
      skipped.push({ rowNumber: row.lineNumber, reasonCode: resolved.reasonCode })
      if (resolved.reasonCode === 'unresolved_staff') {
        const normalized = row.staffNameRaw.trim()
        const existing = unresolvedStaffMap.get(normalized)
        if (existing) existing.occurrenceCount += 1
        else unresolvedStaffMap.set(normalized, { rawName: row.staffNameRaw, normalized, occurrenceCount: 1 })
      }
      continue
    }

    const customerDecision = decideReservationCustomerMatch(resolved.nameCandidates)
    if (customerDecision.status === 'needs_review') {
      needsReview.push({
        rowNumber: row.lineNumber,
        customerName: row.customerName,
        candidateMatchName: customerDecision.candidates[0].displayLabel,
      })
    }

    if (preview.length < 10) {
      preview.push({
        rowNumber:       row.lineNumber,
        visitDate:       formatVisitDate(row.visitDate),
        startTime:       formatTime(row.startTime),
        endTime:         formatTime(row.endTime),
        durationMinutes: row.durationMinutes,
        staffNameRaw:    row.staffNameRaw,
        menuName:        row.menuName,
        statusRaw:       row.statusRaw,
        mappedStatus:    resolved.status,
        customerName:    row.customerName,
      })
    }
  }

  const importable = Math.max(0, parsed.rows.length - skipped.length - needsReview.length)

  return {
    ok: true,
    result: {
      fileName:  input.fileName,
      totalRows: parsed.totalLines,
      importable,
      needsReview,
      skipped,
      unresolvedStaff: Array.from(unresolvedStaffMap.values()),
      preview,
    },
  }
}

// ───────────────────────── Import実行 ─────────────────────────

export interface ReservationImportInput {
  storeId:         string
  fileName?:       string
  csvText:         string
  reviewDecisions: Record<number, 'merge' | 'new'>
}

export type ReservationImportResult =
  | { ok: true; report: ReservationImportReport }
  | { ok: false; code: string; message: string }

export async function runReservationImportPipeline(
  input: ReservationImportInput, repos: ReservationPipelineRepos, supabase: SupabaseClient
): Promise<ReservationImportResult> {
  const startedAt = Date.now()
  const parsed = parseReservationCsv(input.csvText)
  const fatal = parsed.issues.find(i => FATAL_ISSUE_CODES.has(i.code))
  if (fatal) return { ok: false, code: fatal.code, message: fatal.message }

  const ctx = await buildResolveContext(input.storeId, repos, supabase)

  let created = 0
  let updated = 0
  let skipped = parsed.issues.filter(i => i.lineNumber !== undefined).length
  let needsReviewCount = 0

  for (const row of parsed.rows) {
    const resolved = resolveRow(row, ctx)
    if (!resolved.ok) {
      skipped += 1
      continue
    }

    let brainCustomerId: string
    const decision = decideReservationCustomerMatch(resolved.nameCandidates)

    if (decision.status === 'matched') {
      brainCustomerId = decision.customerId
    } else if (decision.status === 'needs_review') {
      needsReviewCount += 1
      const choice = input.reviewDecisions[row.lineNumber] ?? 'new'
      if (choice === 'merge') {
        brainCustomerId = decision.candidates[0].customerId
      } else {
        const createdCustomer = await repos.customerRepo.create({
          storeId: input.storeId, name: row.customerName, ageGroup: null,
          firstVisitDate: resolved.status === 'completed' ? formatVisitDate(row.visitDate) : null,
          prefecture: null, city: null, externalKeyHash: null,
        })
        ctx.customers.push(createdCustomer)
        brainCustomerId = createdCustomer.id
      }
    } else {
      const createdCustomer = await repos.customerRepo.create({
        storeId: input.storeId, name: row.customerName, ageGroup: null,
        firstVisitDate: resolved.status === 'completed' ? formatVisitDate(row.visitDate) : null,
        prefecture: null, city: null, externalKeyHash: null,
      })
      ctx.customers.push(createdCustomer)
      brainCustomerId = createdCustomer.id
    }

    const upsertInput: ReservationUpsertInput = {
      staffId:         resolved.profileId,
      brainCustomerId,
      menu:            row.menuName,
      price:           row.totalAmount,
      scheduledAt:     resolved.scheduledAt,
      durationMinutes: row.durationMinutes,
      status:          resolved.status,
      isNewCustomer:   mapIsFirstVisit(row.isFirstVisitRaw),
      notes:           row.notes,
    }

    const existing = await repos.reservationRepo.findByNaturalKey(resolved.scheduledAt, brainCustomerId)
    if (existing) {
      await repos.reservationRepo.update(existing.id, upsertInput)
      updated += 1
    } else {
      await repos.reservationRepo.create(upsertInput)
      created += 1
    }
  }

  const durationMs = Date.now() - startedAt

  await repos.opsLogRepo.insert({
    storeId: input.storeId,
    kind:    'reservation_csv_import',
    actorId: null,
    detail:  { fileName: input.fileName ?? '', rows: parsed.totalLines, created, updated, skipped, needsReviewCount, durationMs },
  })

  return { ok: true, report: { created, updated, skipped, needsReviewCount, durationMs } }
}

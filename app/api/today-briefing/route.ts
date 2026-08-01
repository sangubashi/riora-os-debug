/**
 * GET /api/today-briefing
 *
 * 今日タブ「来店前30秒ブリーフィング」画面用API。
 * 今日の予約（担当=ログイン中スタッフ、admin は全件）から「次のお客様」を特定し、
 * 禁忌 → 触れないこと → 今日の焦点 の優先順で最大3件の注意事項、詳細情報、
 * このあとの予約一覧を返す。
 *
 * データ源:
 *   予約         reservations × brain_customers（/api/home/reservations と同じJOIN）
 *   予約メニュー・予約備考  reservations.menu / reservations.notes（CUSTOMER_BRIEFING_IMPLEMENT_1・
 *                値がある場合のみ返す。既存のreservations取得クエリに列を追加しただけで新規クエリなし）
 *   来店回数・前回施術  brain_visits（+ brain_menus でメニュー名解決）
 *   ①禁忌        contraindications
 *   ②触れないこと  voice_notes.ng_topics（最新1件）+ customer_memories(is_sensitive=true)
 *   ③今日の焦点   timeline_summary_cache.focus（生成済みキャッシュのみ。新規生成はしない）
 *   覚えておくこと customer_memories(is_sensitive=false)
 *   AIまとめ      booking_prompts.summary（次の予約に紐づくもの）→ 無ければ handover_notes.summary
 *   引継ぎメモ    handover_notes.summary（CUSTOMER_BRIEFING_IMPLEMENT_3・AIまとめとは別に単独公開。
 *                既存のhandoverRes取得結果を再利用するのみで新規クエリなし）
 *   最近の変化    timeline_summary_cache.recent_change（TODAY_BRIEFING_IMPLEMENT_4・
 *                既存のfocusRes取得クエリにSELECT列を追加しただけで新規クエリなし。
 *                生成済みキャッシュのみ参照・新規LLM呼び出しはしない）
 *   今回意識すること timeline_summary_cache.next_focus（同上。最大3件）
 *   今日のブリーフィングサマリー（PHASE STAFF-NOTIFICATION-AI・STAFF-NOTIFICATION-AI-2）:
 *                summary配下の各カウント。本日の予約者分は reservations×brain_visits×
 *                contraindications×customer_memories から、まだ予約が入っていない
 *                担当顧客(brain_customers.assigned_staff_id)分は brain_customers×
 *                brain_visits から、それぞれルールベース(LLM不使用)で算出する。
 *
 * ID空間の注意（2026-07-03 監査で確定、2026-07-19 TODAY_BRIEFING_CUSTOMER_MAPPING_AUDIT_V1
 * により解決方式を修正）:
 *   contraindications / voice_notes / handover_notes の customer_id は
 *   legacy customers.id を参照するFK制約が付いている（brain_customers.id ではない）。
 *   customer_memories / timeline_summary_cache の customer_id は brain_customers.id 基準
 *   （canAccessCustomer.ts の実装で確認済み）。
 *   このため上記3テーブルへの問い合わせ前に resolveLegacyCustomerIds()（CUSTOMER_MERGE_
 *   BUILD_FIX_1でsrc/lib/へ切り出し済み）で legacy customers.id の候補（複数）を求める。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../lib/repos'
import { extractStaffFromRequest, type RequestingStaff } from '@/lib/auth/extractStaffFromRequest'
import { resolveLegacyCustomerIds } from '@/lib/resolveLegacyCustomerIds'
import { detectNotificationsForCustomer, type NotificationCustomerInput } from '@/lib/notifications/detectNotifications'
import { countOverdueCustomers, type RosterCustomerInput, type DailyOverdueCounts } from '@/lib/todayBriefing/detectOverdueCustomers'
import { normalizeProductName } from '../customers/[id]/homecare-products/route'
import type {
  TodayBriefingResponse,
  TodayBriefingCaution,
  TodayBriefingUpcoming,
  TodayBriefingSummary,
  TodayBriefingNotificationTarget,
  TodayBriefingNotificationTargets,
} from '@/types/todayBriefing'

const BRAIN_TYPE_MAP: Record<string, string> = {
  'A_acne':      '効果重視型',
  'B_pore':      '効果重視型',
  'C_sensitive': '慎重・不安型',
  'D_aging':     'VIP型',
}
const VALID_TYPES = new Set(['VIP型', '慎重・不安型', '感情重視型', '効果重視型', '信頼構築型'])

function resolveType(t: string | null): string {
  if (!t) return '信頼構築型'
  if (BRAIN_TYPE_MAP[t]) return BRAIN_TYPE_MAP[t]
  if (VALID_TYPES.has(t)) return t
  return '信頼構築型'
}

export function todayJst(): { start: string; end: string } {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const date = jst.toISOString().split('T')[0]
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` }
}

/** todayJst()と同じJST基準で「翌日」の開始・終了を返す(来店リマインドの前日〜当日判定用)。 */
export function tomorrowJst(): { start: string; end: string } {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000)
  const date = jst.toISOString().split('T')[0]
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` }
}

export const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/** 空欄なら非表示にするため null へ正規化する（CUSTOMER_BRIEFING_IMPLEMENT_1）。 */
function blankToNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

const EMPTY_SUMMARY: TodayBriefingSummary = {
  visitCount: 0, firstVisitCount: 0, contraindicationCount: 0,
  homecareCount: 0, birthdayCount: 0, importantMemoCount: 0,
  recommendedRevisitCount: 0, staleVisitCount: 0, retailReplenishCount: 0,
}

const EMPTY_TARGETS: TodayBriefingNotificationTargets = {
  firstVisit: [], contraindication: [], homecare: [], birthday: [],
  importantMemo: [], recommendedRevisit: [], staleVisit: [], retailReplenish: [],
}

const EMPTY_RESPONSE: TodayBriefingResponse = {
  next: null,
  cautions: [],
  detail: {
    lastVisitDate: null, lastVisitMenu: null, memoryNote: null, aiSummary: null, handoverNote: null,
    recentChange: null, nextFocus: [],
  },
  upcoming: [],
  summary: EMPTY_SUMMARY,
  notificationTargets: EMPTY_TARGETS,
}

interface OverdueResult {
  counts: DailyOverdueCounts
  recommendedRevisitTargets: TodayBriefingNotificationTarget[]
  staleVisitTargets: TodayBriefingNotificationTarget[]
  retailReplenishTargets: TodayBriefingNotificationTarget[]
}

/**
 * 担当顧客ロスターから「まだ予約が入っていないが対応が必要な人」を集計する
 * (再来推奨日超過・来店45日以上・店販60日以上・PHASE STAFF-NOTIFICATION-AI-2)。
 * 今日の予約の有無と無関係なデータのため、reservations.length===0の早期return
 * より前に呼び出せるよう独立した関数に切り出している(/api/notificationsの
 * 担当ロスター取得と同じ方針: is_internal_user除外・deleted_at除外・非管理者は
 * assigned_staff_idで絞る)。
 *
 * PHASE STAFF-NOTIFICATION-TAP-1(2026-08-01): 通知タップ→Customer Bottom Sheet
 * 遷移用に、該当した顧客のid・nameも合わせて返す(rosterクエリのselectにname追加のみ・
 * 新規クエリなし)。
 */
async function computeOverdueCounts(
  supabase: ReturnType<typeof getServiceClient>,
  staff: RequestingStaff,
  /** 本日すでに予約が入っている顧客のbrain_customers.id。重複通知防止のため除外する。 */
  todayCustomerIds: string[]
): Promise<OverdueResult> {
  let rosterQuery = supabase
    .from('brain_customers')
    .select('id, name, recommended_cycle_days')
    .eq('is_internal_user', false)
    .is('deleted_at', null)
  if (!staff.isAdmin) {
    rosterQuery = staff.staffBrainId
      ? rosterQuery.eq('assigned_staff_id', staff.staffBrainId)
      : rosterQuery.eq('id', '00000000-0000-0000-0000-000000000000') // 0件を保証するダミー条件
  }

  const { data: rosterRows } = await rosterQuery
  const overdueRosterRows = (rosterRows ?? []).filter((r) => !todayCustomerIds.includes(r.id))
  const overdueRosterIds = overdueRosterRows.map((r) => r.id)
  const nameByRosterId = new Map(overdueRosterRows.map((r) => [r.id, r.name as string]))

  const rosterVisitsRes = overdueRosterIds.length > 0
    ? await supabase.from('brain_visits')
        .select('customer_id, visit_date, retail_category')
        .in('customer_id', overdueRosterIds)
        .order('visit_date', { ascending: true })
    : { data: [] as { customer_id: string; visit_date: string; retail_category: string | null }[] }

  const lastVisitByRosterCustomer = new Map<string, string>()
  const lastRetailPurchaseByRosterCustomer = new Map<string, string>()
  for (const v of (rosterVisitsRes.data ?? [])) {
    lastVisitByRosterCustomer.set(v.customer_id, v.visit_date) // 昇順取得のため最後の代入が最新
    if (v.retail_category) lastRetailPurchaseByRosterCustomer.set(v.customer_id, v.visit_date)
  }

  const counts = countOverdueCustomers(
    overdueRosterRows.map((r): RosterCustomerInput => ({
      id: r.id,
      lastVisitDate: lastVisitByRosterCustomer.get(r.id) ?? null,
      lastRetailPurchaseDate: lastRetailPurchaseByRosterCustomer.get(r.id) ?? null,
      recommendedCycleDays: r.recommended_cycle_days ?? null,
    }))
  )

  const toTargets = (ids: string[]): TodayBriefingNotificationTarget[] =>
    ids.map((id) => ({ id, name: nameByRosterId.get(id) ?? '' }))

  return {
    counts,
    recommendedRevisitTargets: toTargets(counts.recommendedRevisitIds),
    staleVisitTargets: toTargets(counts.staleVisitIds),
    retailReplenishTargets: toTargets(counts.retailReplenishIds),
  }
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getServiceClient()
    const { start, end } = todayJst()

    let query = supabase
      .from('reservations')
      .select(`
        id,
        brain_customer_id,
        customer_id,
        staff_id,
        scheduled_at,
        menu,
        notes,
        is_new_customer,
        brain_customer:brain_customers!brain_customer_id (
          id,
          name,
          customer_type,
          assigned_staff_id,
          is_internal_user
        )
      `)
      .not('brain_customer_id', 'is', null)
      // Phase 1-F修正版: CSV取込でキャンセル済みに更新された予約を表示対象から除外する
      // (取込パイプライン側は正しくstatus='cancelled'へ同期しているが、本APIが
      // ステータスを見ずに全件返していたため、キャンセル済み予約も表示されていた)。
      .neq('status', 'cancelled')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      // 同一顧客の重複排除(直後)でcreated_at最新を優先するため、取得順はcreated_at降順にする。
      // 表示用の時系列順(scheduled_at昇順)への並び替えは重複排除の後に行う。
      .order('created_at', { ascending: false })

    if (!staff.isAdmin) {
      query = query.eq('staff_id', staff.authUserId)
    }

    const { data: rawData, error } = await query.limit(50)
    if (error) return NextResponse.json({ error: String(error) }, { status: 500 })

    // Supabase の埋め込みJOIN型推論は brain_customer を配列として推論するため、
    // 実行時の実体（単一オブジェクト or null）に合わせて any[] として扱う
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rawData ?? []) as any[]
    // brain_customer が null のものに加え、内部ユーザー(is_internal_user=true。
    // スタッフ本人の試用・検証購入等)もスタッフアプリの「今日の来店」から完全に除外する。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = raw.filter((r: any) => r.brain_customer != null && !r.brain_customer.is_internal_user)

    // 同一顧客・同日に複数予約がある場合(リスケジュール等)はcreated_at最新の1件のみ残す。
    // 取得順が既にcreated_at降順のため、先頭1件を残すだけでよい。
    const seen = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deduped = valid.filter((r: any) => {
      if (seen.has(r.brain_customer_id)) return false
      seen.add(r.brain_customer_id)
      return true
    })

    // 以降のロジック(次のお客様特定・このあとの予約一覧)は時系列順を前提とするため、
    // 重複排除後にscheduled_at昇順へ並び替える。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reservations = deduped.sort(
      (a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allCustomerIds = reservations.map((r: any) => r.brain_customer.id as string)

    // 再来推奨/来店45日/店販60日は今日の予約の有無と無関係な担当顧客ロスター起点の
    // データのため、reservations.length===0 の早期returnより前に計算する
    // (PHASE STAFF-NOTIFICATION-AI-2)。
    const overdue = await computeOverdueCounts(supabase, staff, allCustomerIds)

    if (reservations.length === 0) {
      return NextResponse.json<TodayBriefingResponse>({
        ...EMPTY_RESPONSE,
        summary: {
          ...EMPTY_SUMMARY,
          recommendedRevisitCount: overdue.counts.recommendedRevisitCount,
          staleVisitCount: overdue.counts.staleVisitCount,
          retailReplenishCount: overdue.counts.retailReplenishCount,
        },
        notificationTargets: {
          ...EMPTY_TARGETS,
          recommendedRevisit: overdue.recommendedRevisitTargets,
          staleVisit: overdue.staleVisitTargets,
          retailReplenish: overdue.retailReplenishTargets,
        },
      })
    }

    const now = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextIdx = reservations.findIndex((r: any) => new Date(r.scheduled_at).getTime() >= now)
    const nextReservation = nextIdx >= 0 ? reservations[nextIdx] : reservations[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upcomingRows = reservations.filter((r: any) => r.id !== nextReservation.id)
    const customerId = nextReservation.brain_customer.id as string

    // contraindications / voice_notes / handover_notes は legacy customers.id 基準のため変換
    const legacyCustomerIds = await resolveLegacyCustomerIds(supabase, customerId)

    // ── 「今日のブリーフィング」サマリー用: 今日の予約全員分のlegacy候補ID
    // (PHASE STAFF-NOTIFICATION-AI)。resolveLegacyCustomerIds()をN回呼ばず、
    // 予約行自身が持つcustomer_id(legacy)をbrain_customer_idと合わせて候補にする
    // (resolveLegacyCustomerIds.tsの「②reservations.customer_id経由のブリッジ」と
    // 同じ考え方を、既に取得済みの予約行から追加クエリなしで導出するだけ)。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allTodayLegacyIds = Array.from(new Set(
      reservations.flatMap((r: any) => [r.brain_customer_id, r.customer_id].filter(Boolean))
    )) as string[]

    const [
      visitsRes, staffRes, contraRes, voiceRes, memoryRes, focusRes, bookingPromptRes, handoverRes,
      todayContraRes, todayMemoriesRes,
    ] = await Promise.allSettled([
      supabase.from('brain_visits')
        .select('customer_id, visit_date, menu_id, retail_category')
        .in('customer_id', allCustomerIds)
        .order('visit_date', { ascending: false }),
      nextReservation.brain_customer.assigned_staff_id
        ? supabase.from('brain_staff').select('name').eq('id', nextReservation.brain_customer.assigned_staff_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('contraindications').select('severity, title, description').in('customer_id', legacyCustomerIds),
      supabase.from('voice_notes').select('ng_topics').in('customer_id', legacyCustomerIds).not('ng_topics', 'is', null).order('created_at', { ascending: false }).limit(1),
      supabase.from('customer_memories').select('content, is_sensitive').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('timeline_summary_cache').select('focus, recent_change, next_focus').eq('customer_id', customerId).maybeSingle(),
      supabase.from('booking_prompts').select('summary').eq('reservation_id', nextReservation.id).maybeSingle(),
      supabase.from('handover_notes').select('summary').in('customer_id', legacyCustomerIds).order('created_at', { ascending: false }).limit(1),
      // ── ここから「今日のブリーフィング」サマリー専用(今日の予約全員が対象) ──
      allTodayLegacyIds.length > 0
        ? supabase.from('contraindications').select('customer_id').in('customer_id', allTodayLegacyIds)
        : Promise.resolve({ data: [] }),
      supabase.from('customer_memories')
        .select('customer_id, memory_type, trigger_date, content, importance, is_sensitive')
        .in('customer_id', allCustomerIds),
    ])

    // ── 来店回数・前回施術 ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allVisits: any[] = visitsRes.status === 'fulfilled' ? (visitsRes.value.data ?? []) : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visitsByCustomer: Record<string, any[]> = {}
    for (const v of allVisits) (visitsByCustomer[v.customer_id] ??= []).push(v)

    const nextVisits = visitsByCustomer[customerId] ?? []
    const lastVisit = nextVisits[0] ?? null
    let lastVisitMenu: string | null = null
    if (lastVisit?.menu_id) {
      const { data: menu } = await supabase.from('brain_menus').select('name').eq('id', lastVisit.menu_id).maybeSingle()
      lastVisitMenu = menu?.name ?? null
    }

    // ── 担当スタッフ名 ──────────────────────────────────────────────────
    const staffName = staffRes.status === 'fulfilled' ? (staffRes.value.data?.name ?? null) : null

    // ── 記憶（sensitive / non-sensitive）─────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memories: any[] = memoryRes.status === 'fulfilled' ? (memoryRes.value.data ?? []) : []
    const sensitiveMemories    = memories.filter(m => m.is_sensitive)
    const nonSensitiveMemories = memories.filter(m => !m.is_sensitive)

    // ── 注意事項: ①禁忌 → ②触れないこと → ③今日の焦点（最大3件）──────────
    const cautions: TodayBriefingCaution[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contraRows: any[] = contraRes.status === 'fulfilled' ? (contraRes.value.data ?? []) : []
    contraRows
      .slice()
      .sort((a, b) =>
        (SEVERITY_ORDER[String(a.severity).toUpperCase()] ?? 9) -
        (SEVERITY_ORDER[String(b.severity).toUpperCase()] ?? 9))
      .forEach(c => cautions.push({
        kind: 'contraindication',
        text: c.description ? `${c.title}：${c.description}` : c.title,
      }))

    const ngTopicsRow = voiceRes.status === 'fulfilled' ? voiceRes.value.data?.[0] : null
    const ngTopics: string[] = Array.isArray(ngTopicsRow?.ng_topics) ? ngTopicsRow!.ng_topics : []
    ngTopics.forEach(t => cautions.push({ kind: 'ng_topic', text: String(t) }))
    sensitiveMemories.forEach(m => cautions.push({ kind: 'ng_topic', text: m.content }))

    const focus = focusRes.status === 'fulfilled' ? (focusRes.value.data?.focus ?? null) : null
    if (focus) cautions.push({ kind: 'focus', text: focus })

    // ── 最近の変化・今回意識すること: timeline_summary_cache（生成済みキャッシュのみ）──
    const recentChange = focusRes.status === 'fulfilled' ? blankToNull(focusRes.value.data?.recent_change ?? null) : null
    const nextFocusRaw = focusRes.status === 'fulfilled' ? focusRes.value.data?.next_focus : null
    const nextFocus: string[] = Array.isArray(nextFocusRaw)
      ? nextFocusRaw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : []

    // ── AIまとめ: 次の予約に紐づくbooking_prompt → 無ければhandover_notes ──
    const bookingPromptSummary = bookingPromptRes.status === 'fulfilled' ? bookingPromptRes.value.data?.summary : null
    const handoverSummary      = handoverRes.status === 'fulfilled' ? handoverRes.value.data?.[0]?.summary : null
    const aiSummary = bookingPromptSummary ?? handoverSummary ?? null

    if (process.env.NODE_ENV === 'development') {
      console.info('[today-briefing]', {
        customerName:      nextReservation.brain_customer.name,
        legacyCustomerIds,
        contraindications: contraRows.length,
        handoverNotes:     handoverRes.status === 'fulfilled' ? (handoverRes.value.data?.length ?? 0) : 0,
        voiceNotes:        voiceRes.status === 'fulfilled' ? (voiceRes.value.data?.length ?? 0) : 0,
        customerMemories:  memories.length,
        bookingPrompts:    bookingPromptSummary ? 1 : 0,
      })
    }

    // ── 「今日のブリーフィング」サマリー(PHASE STAFF-NOTIFICATION-AI) ────────
    // ルールベースのみ・LLM不使用。今日の予約全員分について、既存の検出関数
    // detectNotificationsForCustomer()(誕生日・ホームケア3タッチの判定式は
    // アプリ内通知v1と完全に同一)を、来店ブラックアウト(nearbyVisitDates)を
    // 意図的に空にして呼び出す。当ブラックアウトは「もうすぐ来店するから
    // 遠隔通知は控える」ための抑制であり、まさに今日来店する本人向けの
    // 対面ブリーフィングには適用しない(該当日に来店する本人にホームケアの
    // 話題を振れない、という逆効果を避けるため)。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const todayContraRows: any[] = todayContraRes.status === 'fulfilled' ? (todayContraRes.value.data ?? []) : []
    const todayContraLegacyIds = new Set(todayContraRows.map((r: { customer_id: string }) => r.customer_id))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const todayMemoryRows: any[] = todayMemoriesRes.status === 'fulfilled' ? (todayMemoriesRes.value.data ?? []) : []
    const todayMemoriesByCustomer = new Map<string, typeof todayMemoryRows>()
    for (const m of todayMemoryRows) {
      const list = todayMemoriesByCustomer.get(m.customer_id) ?? []
      list.push(m)
      todayMemoriesByCustomer.set(m.customer_id, list)
    }

    const todayProductCountsByCustomer = new Map<string, Map<string, { count: number; lastPurchasedAt: string }>>()
    for (const v of allVisits) {
      if (!v.retail_category) continue
      const names = String(v.retail_category).split('/').map((n: string) => normalizeProductName(n)).filter(Boolean)
      const map = todayProductCountsByCustomer.get(v.customer_id) ?? new Map()
      for (const name of names) {
        const ex = map.get(name)
        if (ex) {
          ex.count += 1
          if (v.visit_date > ex.lastPurchasedAt) ex.lastPurchasedAt = v.visit_date
        } else {
          map.set(name, { count: 1, lastPurchasedAt: v.visit_date })
        }
      }
      todayProductCountsByCustomer.set(v.customer_id, map)
    }

    let firstVisitCount = 0
    let contraindicationCount = 0
    let homecareCount = 0
    let birthdayCount = 0
    let importantMemoCount = 0

    // PHASE STAFF-NOTIFICATION-TAP-1: 通知タップ→Customer Bottom Sheet遷移用に、
    // 該当した顧客のid・nameも件数と同時に集める(追加クエリなし・ループ内の既存データのみ)。
    const firstVisitTargets: TodayBriefingNotificationTarget[] = []
    const contraindicationTargets: TodayBriefingNotificationTarget[] = []
    const homecareTargets: TodayBriefingNotificationTarget[] = []
    const birthdayTargets: TodayBriefingNotificationTarget[] = []
    const importantMemoTargets: TodayBriefingNotificationTarget[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of reservations as any[]) {
      const bcId = r.brain_customer.id as string
      const bcName = r.brain_customer.name as string

      if (r.is_new_customer) {
        firstVisitCount += 1
        firstVisitTargets.push({ id: bcId, name: bcName })
      }

      const legacyCandidates = [r.brain_customer_id, r.customer_id].filter(Boolean)
      if (legacyCandidates.some((id: string) => todayContraLegacyIds.has(id))) {
        contraindicationCount += 1
        contraindicationTargets.push({ id: bcId, name: bcName })
      }

      const bcMemories = todayMemoriesByCustomer.get(bcId) ?? []
      if (bcMemories.some((m) => m.importance === 'high' && !m.is_sensitive)) {
        importantMemoCount += 1
        importantMemoTargets.push({ id: bcId, name: bcName })
      }

      const input: NotificationCustomerInput = {
        id: bcId,
        name: bcName,
        weddingDate: null,
        firstVisitDate: null,
        lastVisitDate: null,
        memories: bcMemories.map((m) => ({
          memoryType: m.memory_type, triggerDate: m.trigger_date, content: m.content,
        })),
        retailProductCounts: todayProductCountsByCustomer.get(bcId) ?? new Map(),
        skinPrimaryDeltas: [],
        nearbyVisitDates: [],
      }
      const detected = detectNotificationsForCustomer(input)
      if (detected.some((n) => n.kind === 'birthday')) {
        birthdayCount += 1
        birthdayTargets.push({ id: bcId, name: bcName })
      }
      if (detected.some((n) => n.kind.startsWith('homecare_'))) {
        homecareCount += 1
        homecareTargets.push({ id: bcId, name: bcName })
      }
    }

    const summary: TodayBriefingSummary = {
      visitCount: reservations.length,
      firstVisitCount,
      contraindicationCount,
      homecareCount,
      birthdayCount,
      importantMemoCount,
      recommendedRevisitCount: overdue.counts.recommendedRevisitCount,
      staleVisitCount: overdue.counts.staleVisitCount,
      retailReplenishCount: overdue.counts.retailReplenishCount,
    }

    const notificationTargets: TodayBriefingNotificationTargets = {
      firstVisit: firstVisitTargets,
      contraindication: contraindicationTargets,
      homecare: homecareTargets,
      birthday: birthdayTargets,
      importantMemo: importantMemoTargets,
      recommendedRevisit: overdue.recommendedRevisitTargets,
      staleVisit: overdue.staleVisitTargets,
      retailReplenish: overdue.retailReplenishTargets,
    }

    const response: TodayBriefingResponse = {
      next: {
        reservationId: nextReservation.id,
        customerId,
        customerName: nextReservation.brain_customer.name,
        visitCount:   nextVisits.length,
        customerType: resolveType(nextReservation.brain_customer.customer_type),
        staffName,
        scheduledAt:  nextReservation.scheduled_at,
        minutesUntil: Math.max(0, Math.round((new Date(nextReservation.scheduled_at).getTime() - now) / 60000)),
        reservationMenu:  blankToNull(nextReservation.menu),
        reservationNotes: blankToNull(nextReservation.notes),
      },
      cautions: cautions.slice(0, 3),
      detail: {
        lastVisitDate: lastVisit?.visit_date ?? null,
        lastVisitMenu,
        memoryNote: nonSensitiveMemories[0]?.content ?? null,
        aiSummary,
        handoverNote: blankToNull(handoverSummary),
        recentChange,
        nextFocus,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upcoming: upcomingRows.map((r: any): TodayBriefingUpcoming => ({
        reservationId: r.id,
        customerId:    r.brain_customer.id,
        customerName:  r.brain_customer.name,
        visitCount:    (visitsByCustomer[r.brain_customer.id] ?? []).length,
        scheduledAt:   r.scheduled_at,
      })),
      summary,
      notificationTargets,
    }

    return NextResponse.json(response)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

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
 *
 * ID空間の注意（2026-07-03 監査で確定）:
 *   contraindications / voice_notes / handover_notes の customer_id は
 *   legacy customers.id を参照するFK制約が付いている（brain_customers.id ではない）。
 *   customer_memories / timeline_summary_cache の customer_id は brain_customers.id 基準
 *   （canAccessCustomer.ts の実装で確認済み）。
 *   このため上記3テーブルへの問い合わせ前に getLegacyCustomerIdFromBrainCustomer() で
 *   legacy customers.id へ変換する。
 */
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient } from '../../lib/repos'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import type {
  TodayBriefingResponse,
  TodayBriefingCaution,
  TodayBriefingUpcoming,
} from '@/types/todayBriefing'

/**
 * brain_customers.id → legacy customers.id への変換。
 *
 * reservations は brain_customer_id と customer_id(legacy) を両方持ちうる列だが、
 * 直近の予約行では customer_id が NULL のことが多い（brain移行後に作られた予約は
 * legacy側と紐付けられていないため）。そのため「この brain_customer_id を一度でも
 * 持ったことがある予約」全体から customer_id が入っている行を探す。
 * 見つからない場合は null（= legacy側にデータが存在しない顧客）。
 */
async function getLegacyCustomerIdFromBrainCustomer(
  supabase: SupabaseClient,
  brainCustomerId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('reservations')
    .select('customer_id')
    .eq('brain_customer_id', brainCustomerId)
    .not('customer_id', 'is', null)
    .limit(1)
    .maybeSingle()
  return (data as { customer_id: string } | null)?.customer_id ?? null
}

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

function todayJst(): { start: string; end: string } {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const date = jst.toISOString().split('T')[0]
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` }
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/** 空欄なら非表示にするため null へ正規化する（CUSTOMER_BRIEFING_IMPLEMENT_1）。 */
function blankToNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

const EMPTY_RESPONSE: TodayBriefingResponse = {
  next: null,
  cautions: [],
  detail: {
    lastVisitDate: null, lastVisitMenu: null, memoryNote: null, aiSummary: null, handoverNote: null,
    recentChange: null, nextFocus: [],
  },
  upcoming: [],
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
        staff_id,
        scheduled_at,
        menu,
        notes,
        brain_customer:brain_customers!brain_customer_id (
          id,
          name,
          customer_type,
          assigned_staff_id
        )
      `)
      .not('brain_customer_id', 'is', null)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: true })

    if (!staff.isAdmin) {
      query = query.eq('staff_id', staff.authUserId)
    }

    const { data: rawData, error } = await query.limit(50)
    if (error) return NextResponse.json({ error: String(error) }, { status: 500 })

    // Supabase の埋め込みJOIN型推論は brain_customer を配列として推論するため、
    // 実行時の実体（単一オブジェクト or null）に合わせて any[] として扱う
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rawData ?? []) as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = raw.filter((r: any) => r.brain_customer != null)

    // 同一顧客の重複予約は先頭1件のみ残す
    const seen = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reservations = valid.filter((r: any) => {
      if (seen.has(r.brain_customer_id)) return false
      seen.add(r.brain_customer_id)
      return true
    })

    if (reservations.length === 0) {
      return NextResponse.json<TodayBriefingResponse>(EMPTY_RESPONSE)
    }

    const now = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextIdx = reservations.findIndex((r: any) => new Date(r.scheduled_at).getTime() >= now)
    const nextReservation = nextIdx >= 0 ? reservations[nextIdx] : reservations[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upcomingRows = reservations.filter((r: any) => r.id !== nextReservation.id)
    const customerId = nextReservation.brain_customer.id as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allCustomerIds = reservations.map((r: any) => r.brain_customer.id as string)

    // contraindications / voice_notes / handover_notes は legacy customers.id 基準のため変換
    const legacyCustomerId = await getLegacyCustomerIdFromBrainCustomer(supabase, customerId)

    const [
      visitsRes, staffRes, contraRes, voiceRes, memoryRes, focusRes, bookingPromptRes, handoverRes,
    ] = await Promise.allSettled([
      supabase.from('brain_visits')
        .select('customer_id, visit_date, menu_id')
        .in('customer_id', allCustomerIds)
        .order('visit_date', { ascending: false }),
      nextReservation.brain_customer.assigned_staff_id
        ? supabase.from('brain_staff').select('name').eq('id', nextReservation.brain_customer.assigned_staff_id).maybeSingle()
        : Promise.resolve({ data: null }),
      legacyCustomerId
        ? supabase.from('contraindications').select('severity, title, description').eq('customer_id', legacyCustomerId)
        : Promise.resolve({ data: [] }),
      legacyCustomerId
        ? supabase.from('voice_notes').select('ng_topics').eq('customer_id', legacyCustomerId).not('ng_topics', 'is', null).order('created_at', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),
      supabase.from('customer_memories').select('content, is_sensitive').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('timeline_summary_cache').select('focus, recent_change, next_focus').eq('customer_id', customerId).maybeSingle(),
      supabase.from('booking_prompts').select('summary').eq('reservation_id', nextReservation.id).maybeSingle(),
      legacyCustomerId
        ? supabase.from('handover_notes').select('summary').eq('customer_id', legacyCustomerId).order('created_at', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),
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
        legacyCustomerId,
        contraindications: contraRows.length,
        handoverNotes:     handoverRes.status === 'fulfilled' ? (handoverRes.value.data?.length ?? 0) : 0,
        voiceNotes:        voiceRes.status === 'fulfilled' ? (voiceRes.value.data?.length ?? 0) : 0,
        customerMemories:  memories.length,
        bookingPrompts:    bookingPromptSummary ? 1 : 0,
      })
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
    }

    return NextResponse.json(response)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

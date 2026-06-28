/**
 * useHomeStore — 今日の予約リスト専用ストア
 *
 * 予約リスト: reservations テーブル（今日のスケジュール）
 * 顧客統計:   brain_customers + brain_visits（累計売上・来店回数・最終来院日）
 *             /api/customers/brain-stats 経由（service role・RLS bypass）
 */
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { ReservationWithCustomer } from '@/types/database'
import type { UserRole } from '@/types/database'
import type { CustomerBrainStats } from '../../app/api/customers/brain-stats/route'

// ─── Store types ──────────────────────────────────────────────────────────────

interface HomeState {
  reservations: ReservationWithCustomer[]
  isFallback:   boolean
  isLoading:    boolean

  fetchTodayReservations: (role: UserRole, uid: string) => Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayRange(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

const RESERVATION_SELECT = `
  id,
  customer_id,
  staff_id,
  menu,
  price,
  scheduled_at,
  duration_minutes,
  status,
  is_new_customer,
  notes,
  created_at,
  customer:customers (
    name,
    customer_type,
    is_vip,
    visit_count,
    churn_risk_score,
    last_visit_date,
    total_spent
  )
`

/**
 * brain_* から取得した実データで ReservationWithCustomer を上書きする。
 * 名前マッチが取れなかった場合は元の customers テーブル値をそのまま維持する。
 */
function enrichWithBrainStats(
  reservations: ReservationWithCustomer[],
  stats: Record<string, CustomerBrainStats>
): ReservationWithCustomer[] {
  return reservations.map(r => {
    const s = stats[r.customer?.name ?? ''];
    if (!s) return r;
    return {
      ...r,
      customer: {
        ...r.customer,
        visit_count:      s.visitCount,
        total_spent:      s.totalSpent,
        last_visit_date:  s.lastVisitDate,
        churn_risk_score: Math.round(s.churnScore * 100),
        is_vip:           s.isVip,
        customer_type:    s.customerType ?? r.customer?.customer_type,
      },
    };
  });
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useHomeStore = create<HomeState>((set) => ({
  reservations: [],
  isFallback:   false,
  isLoading:    false,

  fetchTodayReservations: async (role: UserRole, uid: string) => {
    set({ isLoading: true })
    try {
      const { start, end } = todayRange()

      // ── 1. 今日の予約を取得 ────────────────────────────────────────────
      let query = supabase
        .from('reservations')
        .select(RESERVATION_SELECT)
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .order('scheduled_at', { ascending: true })

      if (role === 'staff') {
        query = query.eq('staff_id', uid)
      }

      const { data, error } = await query.limit(50)
      if (error) return

      let mapped = ((data ?? []) as unknown as ReservationWithCustomer[]).filter(
        (r) => r.customer != null
      )
      let isFallback = false

      if (mapped.length === 0) {
        let fallbackQuery = supabase
          .from('reservations')
          .select(RESERVATION_SELECT)
          .order('scheduled_at', { ascending: false })
          .limit(5)

        if (role === 'staff') {
          fallbackQuery = fallbackQuery.eq('staff_id', uid)
        }

        const { data: fallbackData, error: fallbackError } = await fallbackQuery

        if (!fallbackError && fallbackData) {
          mapped = (fallbackData as unknown as ReservationWithCustomer[])
            .filter((r) => r.customer != null)
            .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
          isFallback = mapped.length > 0
        }
      }

      // ── 2. brain_* で顧客統計を実データに差し替え ─────────────────────
      if (mapped.length > 0) {
        const nameSet = new Set(mapped.map(r => r.customer?.name).filter(Boolean) as string[])
        const names: string[] = Array.from(nameSet)
        try {
          const res = await fetch(
            `/api/customers/brain-stats?names=${encodeURIComponent(names.join(','))}`
          )
          if (res.ok) {
            const json = await res.json() as { stats: Record<string, CustomerBrainStats> }
            mapped = enrichWithBrainStats(mapped, json.stats)
          }
        } catch {
          // brain 取得失敗時は customers テーブル値で継続
        }
      }

      set({ reservations: mapped, isFallback })
    } catch {
      // silent
    } finally {
      set({ isLoading: false })
    }
  },
}))

/**
 * useHomeStore — 今日の予約リスト専用ストア（Pass V-1/V-2: brain_customers 完全統一）
 *
 * 予約リスト: reservations（brain_customer_id IS NOT NULL のみ取得）
 * 顧客情報:   brain_customers（FK JOIN via brain_customer_id）
 * 顧客統計:   brain_visits（累計売上・来店回数・最終来院日）
 *             /api/customers/brain-stats 経由（service role・RLS bypass）
 *
 * customers テーブルは一切参照しない。
 * brain_customer_id が NULL の予約はクエリ段階で除外する。
 */
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { ReservationWithBrainCustomer } from '@/types/database'
import type { UserRole } from '@/types/database'
import type { CustomerBrainStats } from '../../app/api/customers/brain-stats/route'

// ─── Store types ──────────────────────────────────────────────────────────────

interface HomeState {
  reservations: ReservationWithBrainCustomer[]
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
  brain_customer_id,
  staff_id,
  menu,
  price,
  scheduled_at,
  duration_minutes,
  status,
  is_new_customer,
  notes,
  created_at,
  brain_customer:brain_customers!brain_customer_id (
    id,
    name,
    customer_type,
    churn_score,
    is_subscriber
  )
`

/**
 * brain_visits 集計（brain-stats API）で ReservationWithBrainCustomer を上書きする。
 * brain_customer.name で完全一致するためスペース正規化不要。
 */
function enrichWithBrainStats(
  reservations: ReservationWithBrainCustomer[],
  stats: Record<string, CustomerBrainStats>
): ReservationWithBrainCustomer[] {
  return reservations.map(r => {
    const bc = r.brain_customer
    if (!bc) return r
    const s = stats[bc.name]
    if (!s) return r
    return {
      ...r,
      brain_customer: {
        ...bc,
        visit_count:     s.visitCount,
        total_spent:     s.totalSpent,
        last_visit_date: s.lastVisitDate,
        is_vip:          s.isVip,
        customer_type:   s.customerType ?? bc.customer_type,
      },
    }
  })
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

      // ── 1. 今日の予約を取得（brain_customer_id 連携済みのみ）─────────────
      let query = supabase
        .from('reservations')
        .select(RESERVATION_SELECT)
        .not('brain_customer_id', 'is', null)
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .order('scheduled_at', { ascending: true })

      if (role === 'staff') {
        query = query.eq('staff_id', uid)
      }

      const { data, error } = await query.limit(50)
      if (error) return

      let mapped = ((data ?? []) as unknown as ReservationWithBrainCustomer[]).filter(
        (r) => r.brain_customer != null
      )
      let isFallback = false

      if (mapped.length === 0) {
        // ── 2. 今日の予約なし → brain_customer 連携済み最新5件 ───────────
        let fallbackQuery = supabase
          .from('reservations')
          .select(RESERVATION_SELECT)
          .not('brain_customer_id', 'is', null)
          .order('scheduled_at', { ascending: false })
          .limit(5)

        if (role === 'staff') {
          fallbackQuery = fallbackQuery.eq('staff_id', uid)
        }

        const { data: fallbackData, error: fallbackError } = await fallbackQuery

        if (!fallbackError && fallbackData) {
          mapped = (fallbackData as unknown as ReservationWithBrainCustomer[])
            .filter((r) => r.brain_customer != null)
            .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
          isFallback = mapped.length > 0
        }
      }

      // ── 3. brain_visits で顧客統計を実データに差し替え ────────────────
      if (mapped.length > 0) {
        const nameSet = new Set(
          mapped.map(r => r.brain_customer?.name).filter(Boolean) as string[]
        )
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
          // brain_visits 取得失敗時は brain_customers 基本情報で継続
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

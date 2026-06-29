/**
 * useHomeStore — 今日の予約リスト専用ストア（Pass V-2: service role API 経由）
 *
 * 予約リスト: /api/home/reservations（service role・RLSバイパス）
 *   - brain_customer_id IS NOT NULL のみ
 *   - brain_customers を FK JOIN
 * 顧客統計: /api/customers/brain-stats（brain_visits 集計）
 *
 * Supabase anon クライアントから brain_customers を直接 JOIN しない。
 * customers テーブルは一切参照しない。
 */
import { create } from 'zustand'
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
      // ── 1. service role API で予約を取得（RLSバイパス）──────────────────
      const res = await fetch(
        `/api/home/reservations?role=${encodeURIComponent(role)}&uid=${encodeURIComponent(uid)}`
      )
      if (!res.ok) return

      const { reservations: raw, isFallback } =
        await res.json() as { reservations: ReservationWithBrainCustomer[]; isFallback: boolean }

      let mapped = raw

      // ── 2. brain_visits で顧客統計を実データに差し替え ────────────────
      if (mapped.length > 0) {
        const nameSet = new Set(
          mapped.map(r => r.brain_customer?.name).filter(Boolean) as string[]
        )
        const names = Array.from(nameSet)
        try {
          const statsRes = await fetch(
            `/api/customers/brain-stats?names=${encodeURIComponent(names.join(','))}`
          )
          if (statsRes.ok) {
            const json =
              await statsRes.json() as { stats: Record<string, CustomerBrainStats> }
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

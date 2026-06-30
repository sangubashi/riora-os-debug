/**
 * useHomeStore — 今日の予約リスト専用ストア
 *
 * 予約リスト: /api/home/reservations（service role・RLSバイパス）
 *   - 今日の予約のみ（フォールバックなし）
 *   - brain_customer_id IS NOT NULL のみ
 *   - 同一顧客重複なし
 * 顧客統計: /api/customers/brain-stats（brain_visits 集計）
 *
 * customers テーブル・Supabase anon クライアントは使用しない。
 */
import { create } from 'zustand'
import type { ReservationWithBrainCustomer } from '@/types/database'
import type { UserRole } from '@/types/database'
import type { CustomerBrainStats } from '../../app/api/customers/brain-stats/route'
import { authedFetch } from '@/lib/api/authedFetch'

// ─── Store types ──────────────────────────────────────────────────────────────

interface HomeState {
  reservations: ReservationWithBrainCustomer[]
  isLoading:    boolean

  fetchTodayReservations: (role: UserRole, uid: string) => Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  isLoading:    false,

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fetchTodayReservations: async (_role: UserRole, _uid: string) => {
    set({ isLoading: true })
    try {
      // ── 1. JWT 認証付きで今日の予約を取得（スタッフはJWT内IDで自動フィルタ）
      const res = await authedFetch('/api/home/reservations')
      if (!res.ok) {
        console.warn('[HomeStore] API error:', res.status)
        return
      }

      const { reservations: raw } =
        await res.json() as { reservations: ReservationWithBrainCustomer[] }

      // ⑤ ログ出力
      console.log('[HomeStore] 取得件数:', raw.length)
      console.log('[HomeStore] 顧客名・予約日時:',
        raw.map(r => ({
          name:        r.brain_customer?.name ?? '(unknown)',
          scheduledAt: r.scheduled_at,
          bcId:        r.brain_customer_id,
        }))
      )

      let mapped = raw

      // ── 2. brain_visits で顧客統計を補完 ─────────────────────────────
      if (mapped.length > 0) {
        const nameSet = new Set(
          mapped.map(r => r.brain_customer?.name).filter(Boolean) as string[]
        )
        const names = Array.from(nameSet)
        try {
          const statsRes = await authedFetch(
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

      set({ reservations: mapped })
    } catch (e) {
      console.error('[HomeStore] fetchTodayReservations error:', e)
    } finally {
      set({ isLoading: false })
    }
  },
}))

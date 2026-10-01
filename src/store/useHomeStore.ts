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

/** 当日キャンセル/取消の結果(2026-10-01・/karteの当日キャンセル機能)。 */
export type ReservationCancelResult = { ok: true } | { ok: false; error: string }

interface HomeState {
  reservations: ReservationWithBrainCustomer[]
  /** 当日キャンセル(キャンセル日時が本日JSTの予約)。/karteの「当日キャンセル」欄用。 */
  cancelledToday: ReservationWithBrainCustomer[]
  isLoading:    boolean

  fetchTodayReservations: (role: UserRole, uid: string) => Promise<void>
  /** 予約を当日キャンセルにする(成功時は一覧を再取得)。 */
  cancelReservation:  (reservation: ReservationWithBrainCustomer) => Promise<ReservationCancelResult>
  /** 当日キャンセルを取り消して通常予約へ戻す(成功時は一覧を再取得)。 */
  restoreReservation: (reservation: ReservationWithBrainCustomer) => Promise<ReservationCancelResult>
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
        last_menu:       s.lastMenu,
        is_vip:          s.isVip,
        customer_type:   s.customerType ?? bc.customer_type,
      },
    }
  })
}

/**
 * 担当者名の解決(PHASE IPAD-KARTE-ENTRY-1 UI刷新・2026-09-20ユーザー承認)。
 * reservations.staff_id(auth.users.id)を、担当者タグ選択で使っている
 * `/api/staff/active-list`のuser_idと突き合わせて表示用の名前をマージする。
 * 解決できない場合(店舗共通アカウント自身・久保田(admin)・退職済みスタッフ等)は
 * staff_nameを付与せず、表示側でフォールバックする。
 */
function enrichWithStaffNames(
  reservations: ReservationWithBrainCustomer[],
  staffByUserId: Record<string, string>
): ReservationWithBrainCustomer[] {
  return reservations.map(r => {
    const name = staffByUserId[r.staff_id]
    if (!name) return r
    return { ...r, staff_name: name }
  })
}

/**
 * PATCH /api/reservations/[id]/cancel を呼び、成功時は本日の予約を再取得する。
 * 失敗時はAPIのerrorコード(already_cancelled / conflict / forbidden等)をそのまま返す。
 */
async function callCancelApi(
  reservation: ReservationWithBrainCustomer,
  action: 'cancel' | 'restore',
  refetch: (role: UserRole, uid: string) => Promise<void>,
): Promise<ReservationCancelResult> {
  try {
    const res = await authedFetch(`/api/reservations/${reservation.id}/cancel`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, brainCustomerId: reservation.brain_customer_id }),
    })
    const json = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (!res.ok || !json.success) {
      // 二重送信・他端末での操作済み(409)でも一覧は最新化しておく。
      if (res.status === 409) await refetch('staff', '')
      return { ok: false, error: json.error ?? 'request_failed' }
    }
    await refetch('staff', '')
    return { ok: true }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useHomeStore = create<HomeState>((set, get) => ({
  reservations: [],
  cancelledToday: [],
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

      const { reservations: raw, cancelledToday: rawCancelled } =
        await res.json() as {
          reservations: ReservationWithBrainCustomer[]
          cancelledToday?: ReservationWithBrainCustomer[]
        }

      let mapped = raw
      let mappedCancelled = rawCancelled ?? []

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

        // ── 3. 担当者タグ一覧(/api/staff/active-list)で担当者名を補完 ─────
        try {
          const staffRes = await authedFetch('/api/staff/active-list')
          if (staffRes.ok) {
            const json = await staffRes.json() as {
              success: boolean
              staff?: { id: string; name: string; user_id: string | null }[]
            }
            if (json.success && json.staff) {
              const staffByUserId: Record<string, string> = {}
              for (const s of json.staff) {
                if (s.user_id) staffByUserId[s.user_id] = s.name
              }
              mapped = enrichWithStaffNames(mapped, staffByUserId)
              mappedCancelled = enrichWithStaffNames(mappedCancelled, staffByUserId)
            }
          }
        } catch {
          // 担当者名の解決に失敗しても本日の予約表示自体は継続(フォールバック表示)
        }
      }

      set({ reservations: mapped, cancelledToday: mappedCancelled })
    } catch (e) {
      console.error('[HomeStore] fetchTodayReservations error:', e)
    } finally {
      set({ isLoading: false })
    }
  },

  cancelReservation: (reservation) => callCancelApi(reservation, 'cancel', get().fetchTodayReservations),
  restoreReservation: (reservation) => callCancelApi(reservation, 'restore', get().fetchTodayReservations),
}))

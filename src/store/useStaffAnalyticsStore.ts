/**
 * useStaffAnalyticsStore.ts — 画面④スタッフ分析(MD-4)の状態管理
 *
 * GET /api/admin/staff-analyticsをfetchするだけ(集計はAPI側で完了済み)。
 * ランキング・並び替えのアクションはこのストアに持たせない(常に五十音順で受け取った順を保持する)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface StaffAnalyticsRow {
  staffId: string
  staffName: string
  monthlySales: number
  nominationRate: number | null
  repeatRate: number | null
  ltv: number | null
  growthRate: number | null
}

interface StaffAnalyticsState {
  staffAnalytics: StaffAnalyticsRow[]
  isLoading: boolean
  error: string | null
  fetchStaffAnalytics: (storeId: string, month?: string) => Promise<void>
}

export const useStaffAnalyticsStore = create<StaffAnalyticsState>((set) => ({
  staffAnalytics: [],
  isLoading: false,
  error: null,

  fetchStaffAnalytics: async (storeId: string, month?: string) => {
    set({ isLoading: true, error: null })

    try {
      const params = new URLSearchParams({ storeId })
      if (month) params.set('month', month)
      const res = await authedFetch(`/api/admin/staff-analytics?${params.toString()}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'staff_analytics_fetch_failed', isLoading: false })
        return
      }

      set({ staffAnalytics: body.staffAnalytics, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'staff_analytics_fetch_failed', isLoading: false })
    }
  },
}))

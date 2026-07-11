/**
 * useStaffAnalyticsStore.ts — 画面④スタッフ分析(MD-4)の状態管理
 *
 * GET /api/admin/staff-analyticsをfetchするだけ(集計はAPI側で完了済み)。
 * ランキング・並び替えのアクションはこのストアに持たせない(常に五十音順で受け取った順を保持する)。
 *
 * PHASE MD-2(月選択デフォルト値問題の修正): monthを省略してfetchすると、APIが
 * brain_visitsの最新データ月を自動選択して返す(要件1)。その結果(resolvedMonth/
 * autoSelectedLatestMonth)を保持し、画面側が「最新データ月を表示しています」の
 * 通知(要件3)とselectedMonthの同期に使う。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface StaffAnalyticsRow {
  staffId: string
  staffName: string
  monthlySales: number
  visitCount: number
  avgSpend: number | null
  nominationRate: number | null
  repeatRate: number | null
  ltv: number | null
  growthRate: number | null
}

interface StaffAnalyticsState {
  staffAnalytics: StaffAnalyticsRow[]
  isLoading: boolean
  error: string | null
  /** 直近のレスポンスが実際に集計した年月(YYYY-MM)。monthを省略した場合はAPIが自動判定した月。 */
  resolvedMonth: string | null
  /** APIがmonth未指定を「最新データ月」に自動置換したか(要件1・3の通知表示に使う)。 */
  autoSelectedLatestMonth: boolean
  fetchStaffAnalytics: (storeId: string, month?: string) => Promise<void>
}

export const useStaffAnalyticsStore = create<StaffAnalyticsState>((set) => ({
  staffAnalytics: [],
  isLoading: false,
  error: null,
  resolvedMonth: null,
  autoSelectedLatestMonth: false,

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

      set({
        staffAnalytics: body.staffAnalytics,
        resolvedMonth: typeof body.date === 'string' ? body.date.slice(0, 7) : null,
        autoSelectedLatestMonth: Boolean(body.autoSelectedLatestMonth),
        isLoading: false,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'staff_analytics_fetch_failed', isLoading: false })
    }
  },
}))

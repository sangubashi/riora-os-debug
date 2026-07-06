/**
 * useDashboardTopStore.ts — 画面①経営TOP(MD-1)の状態管理
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面①
 *
 * GET /api/dashboard/top をfetchするだけ(集計はnightly-dashboard側で完了済み)。
 * mock禁止のためSupabase直叩き・ハードコード値は持たない。
 * スタッフランキングはv2.0画面④(MD-4)の別契約のため本ストアには含めない。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface Required4 {
  monthlySales: number
  profit: number | null
  breakevenPoint: number | null
  breakevenRemaining: number | null
  forecastSales: number
  fixedCostsConfigured: boolean
}

export interface Kpi4 {
  todaySales: number
  targetProgress: number | null
  salesTarget: number | null
  rebookingRate: number | null
  dmToBookingRate: number | null
}

export interface SalesTrendPoint {
  snapshotDate: string
  monthlySales: number
  forecastSales: number
}

export interface CsvImportStatus {
  lastImportedAt: string
  newCustomers: number
  updatedCustomers: number
  visitsImported: number
  unresolvedStaffCount: number
}

/** DashboardAggregator(nightly)が生成する追加KPI。KPI4枠(v2.0「4枠固定」)には含まれない参考値。 */
export interface ExtendedKpi {
  visitCount: number | null
  repeat30: number | null
  repeat60: number | null
  repeat90: number | null
  nominationRate: number | null
}

/** AIWarningEngine(決定論ルール・LLM不使用)が生成する「今日の一手」1件。 */
export interface TodayAction {
  title: string
  message: string
  severity: 'critical' | 'warning' | 'info'
  targetCount: number
  actionType: 'contact_customer' | 'send_line' | 'review_staff' | 'upsell_campaign'
}

export interface DashboardTopData {
  storeId: string
  date: string
  month: string
  required4: Required4
  kpi4: Kpi4
  extendedKpi: ExtendedKpi
  todayActions: TodayAction[]
  salesTrend: SalesTrendPoint[]
  csvImportStatus: CsvImportStatus | null
}

interface DashboardTopState {
  data: DashboardTopData | null
  isLoading: boolean
  error: string | null
  fetchTop: (storeId: string, month?: string) => Promise<void>
}

export const useDashboardTopStore = create<DashboardTopState>((set) => ({
  data: null,
  isLoading: false,
  error: null,

  fetchTop: async (storeId: string, month?: string) => {
    set({ isLoading: true, error: null })

    try {
      const params = new URLSearchParams({ storeId })
      if (month) params.set('month', month)
      const res = await authedFetch(`/api/dashboard/top?${params.toString()}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'dashboard_top_fetch_failed', isLoading: false })
        return
      }

      const { success, ...data } = body
      set({ data: data as DashboardTopData, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'dashboard_top_fetch_failed', isLoading: false })
    }
  },
}))

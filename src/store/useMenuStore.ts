/**
 * useMenuStore  –  メニュー画面 Zustand ストア
 *
 * GET /api/admin/menuをfetchするだけ(集計はMenuAnalyticsEngine側で完了済み)。
 * brain_menus(メニュー名/価格/role/target_types)+brain_visits(今月の件数・売上/
 * 次回予約率)が実データソース。リピート率/利益率/AI推奨率/アップセル成功率/
 * VIP移行率は実データソースが存在しないため常にnull(UI側で「未実装」等を表示する)。
 */
import { create } from 'zustand'
import type { MenuRole, CustomerType } from '@/types/riora.types'

export interface MenuAnalyticsRow {
  id:              string
  name:            string
  price:           number
  role:            MenuRole
  targetTypes:     CustomerType[]
  monthlyCount:    number
  monthlyRevenue:  number
  totalVisitCount: number
  nextVisitRate:   number | null
  // 実データソースが存在しない指標(将来の設計書実装まで常にnull)
  repeatRate:        null
  profitMargin:      null
  aiRecommendRate:   null
  upsellSuccessRate: null
  vipConversionRate: null
}

export interface DailyRevenuePoint {
  date:    string
  revenue: number
}

export interface MenuAnalyticsSummary {
  totalMenuCount:         number
  monthlyRevenueTotal:    number
  lastMonthRevenueTotal:  number
  momRevenueChangePct:    number | null
  dailyRevenueLast7Days:  DailyRevenuePoint[]
}

export type FilterTab = 'all' | MenuRole

interface MenuState {
  menus:     MenuAnalyticsRow[]
  summary:   MenuAnalyticsSummary | null
  filterTab: FilterTab
  isLoading: boolean
  error:     string | null

  filteredMenus: () => MenuAnalyticsRow[]
  setFilter:     (tab: FilterTab) => void
  fetchMenus:    (storeId: string) => Promise<void>
}

export const useMenuStore = create<MenuState>((set, get) => ({
  menus:     [],
  summary:   null,
  filterTab: 'all',
  isLoading: false,
  error:     null,

  filteredMenus: () => {
    const { menus, filterTab } = get()
    return filterTab === 'all' ? menus : menus.filter(m => m.role === filterTab)
  },

  setFilter: (tab) => set({ filterTab: tab }),

  fetchMenus: async (storeId) => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch(`/api/admin/menu?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'menu_fetch_failed', isLoading: false })
        return
      }

      set({ menus: body.menus, summary: body.summary, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'menu_fetch_failed', isLoading: false })
    }
  },
}))

/**
 * useOccupancyStore.ts — 画面⑤稼働率分析(MD-5)の状態管理
 *
 * GET /api/admin/occupancyをfetchするだけ(集計はAPI/Repository側で完了済み)。
 * 編集機能は持たない(閲覧専用)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface StaffOccupancyRow {
  staffId: string
  staffName: string
  visitCount: number
  sales: number
  nominationRate: number | null
}

export interface DayOfWeekVisitCount {
  dayOfWeek: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  visitCount: number
}

export interface UnavailableSection {
  available: false
  reason: string
}

export interface OccupancyData {
  storeId: string
  date: string
  staffOccupancy: StaffOccupancyRow[]
  dayOfWeekVisits: DayOfWeekVisitCount[]
  hourlyVisits: UnavailableSection
  occupancyTrend: UnavailableSection
}

interface OccupancyState {
  data: OccupancyData | null
  isLoading: boolean
  error: string | null
  fetchOccupancy: (storeId: string) => Promise<void>
}

export const useOccupancyStore = create<OccupancyState>((set) => ({
  data: null,
  isLoading: false,
  error: null,

  fetchOccupancy: async (storeId: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await authedFetch(`/api/admin/occupancy?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'occupancy_fetch_failed', isLoading: false })
        return
      }

      const { success, ...data } = body
      set({ data: data as OccupancyData, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'occupancy_fetch_failed', isLoading: false })
    }
  },
}))

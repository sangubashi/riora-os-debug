/**
 * useOccupancyStore.ts — 画面⑤稼働率分析(MD-5)の状態管理
 *
 * GET /api/admin/occupancyをfetchするだけ(集計はAPI/Repository側で完了済み)。
 * 編集機能は持たない(閲覧専用)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface StaffOccupancyComparison {
  visitCountDiff: number
  salesDiff: number
  nominationRateDiff: number
  /** 今月稼働率 − 先月稼働率。稼働率算出式が未実装の間は常にnull。 */
  occupancyRateDiff: number | null
}

export interface StaffOccupancyRow {
  staffId: string
  staffName: string
  /** 今月(月初〜本日)の来店件数。 */
  visitCount: number
  /** 今月の売上。 */
  sales: number
  /** 今月の指名率(0〜1)。今月の担当来店0件はnull。 */
  nominationRate: number | null
  /** 今月の稼働率(0〜1)。seat_capacity未整備のため現時点では常にnull(「データ未整備」表示)。 */
  occupancyRate: number | null
  /** 先月比較。今月・先月とも担当来店が無い場合はnull(「比較データなし」表示)。 */
  comparison: StaffOccupancyComparison | null
}

export interface DayOfWeekVisitCount {
  dayOfWeek: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  visitCount: number
}

export interface UnavailableSection {
  available: false
  reason: string
}

export interface HourlyVisitPoint {
  hour: number
  visitCount: number
}

export interface DailyOccupancyPoint {
  date: string
  occupiedMinutes: number
}

export type HourlyVisitsSection =
  | { available: true; data: HourlyVisitPoint[] }
  | UnavailableSection

export type OccupancyTrendSection =
  | { available: true; data: DailyOccupancyPoint[]; seatCapacityConfigured: boolean; note: string | null }
  | UnavailableSection

export interface OccupancyData {
  storeId: string
  date: string
  staffOccupancy: StaffOccupancyRow[]
  dayOfWeekVisits: DayOfWeekVisitCount[]
  hourlyVisits: HourlyVisitsSection
  occupancyTrend: OccupancyTrendSection
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

/**
 * useKpiStore  –  KPI Dashboard 用 Zustand ストア
 *
 * ・Supabase から daily_kpi_snapshots / weekly_sales / staff_daily_rankings を取得
 * ・環境変数未設定 or エラー時はモックデータにフォールバック
 * ・Supabase Realtime で daily_kpi_snapshots の変更をリアルタイム反映
 */
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { generateKpiHints } from '@/lib/phase8/kpiHintEngine'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Types (src/stores/useKpiStore.ts と互換) ───────────────────────────────

export type KpiKey =
  | 'todaySales'
  | 'monthlySales'
  | 'nextReserveRate'
  | 'avgSpend'
  | 'repeatRate'
  | 'lineResponseRate'
  | 'subscContinueRate'
  | 'occupancyRate'
  | 'vipRate'

export type AiInsightType = 'warning' | 'tip' | 'praise'

export interface AiInsight {
  id:      string
  type:    AiInsightType
  message: string
  action?: string
}

export interface KpiSnapshot {
  todaySales:        number
  monthlySales:      number
  nextReserveRate:   number
  avgSpend:          number
  repeatRate:        number
  lineResponseRate:  number
  subscContinueRate: number
  occupancyRate:     number
  vipRate:           number
}

export interface WeeklyDatum {
  day:          string
  sales:        number
  reservations: number
}

export interface StaffRankItem {
  staffId:           string
  name:              string
  todaySales:        number
  nextReserveCount:  number
  aiAdoptRate:       number
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface KpiStore {
  // data
  current:       KpiSnapshot
  previousDay:   KpiSnapshot
  previousMonth: KpiSnapshot
  weeklyData:    WeeklyDatum[]
  staffRanking:  StaffRankItem[]
  insights:      AiInsight[]

  // ui
  selectedKpi:  KpiKey | null
  isSheetOpen:  boolean

  // async state
  isLoading:    boolean
  error:        string | null
  lastFetchedAt: string | null

  // realtime
  realtimeChannel: RealtimeChannel | null

  // actions
  setSelectedKpi: (key: KpiKey | null) => void
  setSheetOpen:   (open: boolean) => void

  // Supabase fetch methods
  fetchTodayKpi:     () => Promise<void>
  fetchWeeklyData:   () => Promise<void>
  fetchStaffRanking: () => Promise<void>
  fetchInsights:     () => Promise<void>
  fetchAll:          () => Promise<void>

  // Realtime
  subscribeRealtime:   () => void
  unsubscribeRealtime: () => void
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function isoToday() {
  return new Date().toISOString().split('T')[0]
}

function isoMonthStart() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

// ─── Create store ─────────────────────────────────────────────────────────────

const ZERO_SNAPSHOT: KpiSnapshot = { todaySales: 0, monthlySales: 0, nextReserveRate: 0, avgSpend: 0, repeatRate: 0, lineResponseRate: 0, subscContinueRate: 0, occupancyRate: 0, vipRate: 0 }

export const useKpiStore = create<KpiStore>((set, get) => ({
  current:       { ...ZERO_SNAPSHOT },
  previousDay:   { ...ZERO_SNAPSHOT },
  previousMonth: { ...ZERO_SNAPSHOT },
  weeklyData:    [],
  staffRanking:  [],
  insights:      [],

  selectedKpi:  null,
  isSheetOpen:  false,
  isLoading:    false,
  error:        null,
  lastFetchedAt: null,
  realtimeChannel: null,

  setSelectedKpi: (key)  => set({ selectedKpi: key, isSheetOpen: key !== null }),
  setSheetOpen:   (open) => set({ isSheetOpen: open }),

  // ── fetchTodayKpi ───────────────────────────────────────────────
  fetchTodayKpi: async () => {
    set({ isLoading: true, error: null })
    try {
      const today = isoToday()
      const monthStart = isoMonthStart()

      // today + yesterday
      const { data: rows } = await supabase
        .from('daily_kpi_snapshots')
        .select('*')
        .gte('date', monthStart)
        .order('date', { ascending: false })
        .limit(60)

      if (!rows || rows.length === 0) { set({ isLoading: false }); return }

      const todayRow    = rows.find(r => r.date === today)
      const prevDayRow  = rows.find(r => r.date !== today)
      const monthTotal  = rows.reduce((s: number, r: { total_sales: number }) => s + r.total_sales, 0)

      const prevMonthStart = (() => {
        const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1)
        return d.toISOString().split('T')[0]
      })()
      const { data: prevMonthRows } = await supabase
        .from('daily_kpi_snapshots')
        .select('*')
        .gte('date', prevMonthStart)
        .lt( 'date', monthStart)
        .order('date', { ascending: false })
        .limit(60)

      const pmTotal = (prevMonthRows ?? []).reduce((s: number, r: { total_sales: number }) => s + r.total_sales, 0)
      const pmRow   = (prevMonthRows ?? [])[0]

      if (todayRow) {
        set({
          current: {
            todaySales:        todayRow.total_sales,
            monthlySales:      monthTotal,
            nextReserveRate:   Number(todayRow.next_booking_rate),
            avgSpend:          todayRow.avg_spend,
            repeatRate:        Number(todayRow.repeat_rate),
            lineResponseRate:  Number(todayRow.line_reply_rate),
            subscContinueRate: Number(todayRow.subscription_retention),
            occupancyRate:     Number(todayRow.occupancy_rate ?? 0),
            vipRate:           Number(todayRow.vip_rate       ?? 0),
          },
        })
      }

      if (prevDayRow) {
        set({ previousDay: { ...ZERO_SNAPSHOT,
          todaySales:      prevDayRow.total_sales,
          nextReserveRate: Number(prevDayRow.next_booking_rate),
          avgSpend:        prevDayRow.avg_spend,
          repeatRate:      Number(prevDayRow.repeat_rate),
          lineResponseRate: Number(prevDayRow.line_reply_rate),
        }})
      }

      if (pmRow) {
        set({ previousMonth: { ...ZERO_SNAPSHOT,
          monthlySales:     pmTotal,
          nextReserveRate:  Number(pmRow.next_booking_rate),
          avgSpend:         pmRow.avg_spend,
          repeatRate:       Number(pmRow.repeat_rate),
          lineResponseRate: Number(pmRow.line_reply_rate),
        }})
      }

      set({ lastFetchedAt: new Date().toISOString() })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'KPIデータの取得に失敗しました' })
    } finally {
      set({ isLoading: false })
    }
  },

  // ── fetchWeeklyData ─────────────────────────────────────────────
  fetchWeeklyData: async () => {
    try {
      const monday = (() => {
        const d = new Date()
        const day = d.getDay()
        const diff = day === 0 ? -6 : 1 - day
        d.setDate(d.getDate() + diff)
        return d.toISOString().split('T')[0]
      })()

      const { data } = await supabase
        .from('weekly_sales')
        .select('day_label, sales, reservations')
        .eq('week_start', monday)
        .order('day_of_week', { ascending: true })

      if (data && data.length > 0) {
        set({ weeklyData: data.map((r: { day_label: string; sales: number; reservations: number }) => ({
          day:          r.day_label,
          sales:        r.sales,
          reservations: r.reservations,
        }))})
      }
    } catch (e) { console.error('[KpiStore] fetchWeeklyData:', e) }
  },

  // ── fetchStaffRanking ───────────────────────────────────────────
  fetchStaffRanking: async () => {
    try {
      const { data } = await supabase
        .from('staff_daily_rankings')
        .select('*')
        .eq('date', isoToday())
        .order('rank', { ascending: true })
        .limit(5)

      if (data && data.length > 0) {
        set({ staffRanking: data.map((r: {
          staff_id: string; staff_name: string; today_sales: number;
          next_reserve_count: number; ai_adopt_rate: number
        }) => ({
          staffId:          r.staff_id,
          name:             r.staff_name,
          todaySales:       r.today_sales,
          nextReserveCount: r.next_reserve_count,
          aiAdoptRate:      Number(r.ai_adopt_rate),
        }))})
      }
    } catch (e) { console.error('[KpiStore] fetchStaffRanking:', e) }
  },

  // ── fetchInsights ───────────────────────────────────────────────
  fetchInsights: async () => {
    try {
      const { data } = await supabase
        .from('kpi_insights')
        .select('id, type, message, action')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(5)

      if (data && data.length > 0) {
        set({ insights: data as AiInsight[] })
      }
    } catch (e) { console.error('[KpiStore] fetchInsights:', e) }
  },

  // ── fetchAll ────────────────────────────────────────────────────
  fetchAll: async () => {
    const { fetchTodayKpi, fetchWeeklyData, fetchStaffRanking, fetchInsights } = get()
    await Promise.allSettled([
      fetchTodayKpi(),
      fetchWeeklyData(),
      fetchStaffRanking(),
      fetchInsights(),
    ])
    // PHASE8: KPI から改善ヒントを自動生成（kpi_insights テーブルが空でも機能する）
    const { current, previousMonth, insights } = get()
    if (insights.length === 0) {
      const hints = generateKpiHints(current, previousMonth)
      set({ insights: hints })
    }
  },

  // ── Realtime subscription ───────────────────────────────────────
  subscribeRealtime: () => {
    const existing = get().realtimeChannel
    if (existing) return

    const channel = supabase
      .channel('kpi-realtime')
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'daily_kpi_snapshots',
        filter: `date=eq.${isoToday()}`,
      }, () => {
        get().fetchTodayKpi()
      })
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'staff_daily_rankings',
        filter: `date=eq.${isoToday()}`,
      }, () => {
        get().fetchStaffRanking()
      })
      .subscribe()

    set({ realtimeChannel: channel })
  },

  unsubscribeRealtime: () => {
    const ch = get().realtimeChannel
    if (ch) {
      supabase.removeChannel(ch)
      set({ realtimeChannel: null })
    }
  },
}))

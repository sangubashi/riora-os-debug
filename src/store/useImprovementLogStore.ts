/**
 * useImprovementLogStore.ts
 *
 * improvement_action_logs テーブルの読み書き。
 * DEMO_MODE ではメモリストアで動作。
 */
import { create } from 'zustand'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import { runAttributionDemo, linkRevenueToActions, calcAccuracy } from '@/lib/analytics/RevenueAttributionEngine'
import type { CustomerRow }      from '@/store/useCustomerStore'
import type {
  ImprovementActionLog,
  ImprovementActionLogInsert,
  CoachActionType,
  ImprovementRevenueLink,
  ImprovementRevenueLinkInsert,
} from '@/types'

// ─── 統計型 ──────────────────────────────────────────────────────────────────

export interface ActionStats {
  actionType:      CoachActionType
  label:           string
  totalCount:      number
  successCount:    number
  successRate:     number    // 0〜100
  avgRevenue:      number    // 円
  totalRevenue:    number
}

// ─── ラベルマップ ─────────────────────────────────────────────────────────────

export const ACTION_TYPE_LABEL: Record<CoachActionType, string> = {
  rebook_proposal: '次回予約提案',
  product_suggest: '店販提案',
  vip_upgrade:     'VIP昇格提案',
  line_follow:     'LINEフォロー',
  other:           'その他',
}

// ─── DEMO モックデータ ────────────────────────────────────────────────────────

function buildDemoLogs(): ImprovementActionLog[] {
  const now = Date.now()
  return [
    { id: 'l-1', staff_name: '鈴木', action_type: 'rebook_proposal', customer_id: 'c-1', customer_name: '田中 美咲', metric: 'nextReserveRate', created_at: new Date(now - 5 * 86400000).toISOString(), completed_at: new Date(now - 5 * 86400000 + 3600000).toISOString(), result_type: 'success', revenue_generated: 14200, revenue_generated_actual: 14200, attribution_linked_at: new Date().toISOString(), success: true, notes: null },
    { id: 'l-2', staff_name: '鈴木', action_type: 'rebook_proposal', customer_id: 'c-2', customer_name: '高橋 ゆり', metric: 'nextReserveRate', created_at: new Date(now - 4 * 86400000).toISOString(), completed_at: new Date(now - 4 * 86400000 + 3600000).toISOString(), result_type: 'success', revenue_generated: 16000, revenue_generated_actual: 16000, attribution_linked_at: new Date().toISOString(), success: true, notes: null },
    { id: 'l-3', staff_name: '亀山', action_type: 'product_suggest', customer_id: 'c-3', customer_name: '松本 みれい', metric: 'retailRate', created_at: new Date(now - 3 * 86400000).toISOString(), completed_at: new Date(now - 3 * 86400000 + 3600000).toISOString(), result_type: 'success', revenue_generated: 8800, revenue_generated_actual: 8800, attribution_linked_at: new Date().toISOString(), success: true, notes: null },
    { id: 'l-4', staff_name: '外舘', action_type: 'rebook_proposal', customer_id: 'c-4', customer_name: '佐藤 明子', metric: 'nextReserveRate', created_at: new Date(now - 2 * 86400000).toISOString(), completed_at: new Date(now - 2 * 86400000 + 3600000).toISOString(), result_type: 'fail', revenue_generated: 0, revenue_generated_actual: 0, attribution_linked_at: new Date().toISOString(), success: false, notes: null },
    { id: 'l-5', staff_name: '亀山', action_type: 'vip_upgrade', customer_id: 'c-5', customer_name: '伊藤 さくら', metric: 'vipRate', created_at: new Date(now - 86400000).toISOString(), completed_at: new Date(now - 86400000 + 3600000).toISOString(), result_type: 'success', revenue_generated: 27000, revenue_generated_actual: 27000, attribution_linked_at: new Date().toISOString(), success: true, notes: null },
    { id: 'l-6', staff_name: '鈴木', action_type: 'line_follow', customer_id: 'c-6', customer_name: '鈴木 花子', metric: 'lineResponseAvg', created_at: new Date(now - 7 * 86400000).toISOString(), completed_at: new Date(now - 7 * 86400000 + 1800000).toISOString(), result_type: 'success', revenue_generated: 14200, revenue_generated_actual: 14200, attribution_linked_at: new Date().toISOString(), success: true, notes: null },
    { id: 'l-7', staff_name: '外舘', action_type: 'product_suggest', customer_id: 'c-7', customer_name: '渡辺 あやか', metric: 'retailRate', created_at: new Date(now - 6 * 86400000).toISOString(), completed_at: new Date(now - 6 * 86400000 + 3600000).toISOString(), result_type: 'fail', revenue_generated: 0, revenue_generated_actual: 0, attribution_linked_at: new Date().toISOString(), success: false, notes: null },
  ]
}

// ─── ストア ───────────────────────────────────────────────────────────────────

interface ImprovementLogState {
  logs:         ImprovementActionLog[]
  revenueLinks: ImprovementRevenueLink[]
  isLoading:    boolean

  fetchLogs:       () => Promise<void>
  addLog:          (item: ImprovementActionLogInsert) => Promise<string>
  completeLog:     (id: string, success: boolean, revenue: number) => Promise<void>
  addRevenueLink:  (item: ImprovementRevenueLinkInsert) => Promise<void>
  getStats:        () => ActionStats[]
  getMonthTotal:   () => { totalRevenue: number; successCount: number; totalCount: number }
  getLinkedRevenue:       (actionLogId: string) => number
  runRevenueAttribution:  (customers: CustomerRow[]) => Promise<void>
  getAccuracy:            () => import('@/lib/analytics/RevenueAttributionEngine').AccuracyMetrics
}

export const useImprovementLogStore = create<ImprovementLogState>((set, get) => ({
  logs:         DEMO_MODE ? buildDemoLogs() : [],
  revenueLinks: [],
  isLoading:    false,

  fetchLogs: async () => {
    if (DEMO_MODE) return

    set({ isLoading: true })
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const [logsRes, linksRes] = await Promise.all([
      supabase.from('improvement_action_logs').select('*').gte('created_at', since).order('created_at', { ascending: false }),
      supabase.from('improvement_revenue_links').select('*').gte('created_at', since),
    ])
    set({
      logs:         (logsRes.data  ?? []) as ImprovementActionLog[],
      revenueLinks: (linksRes.data ?? []) as ImprovementRevenueLink[],
      isLoading:    false,
    })
  },

  addLog: async (item) => {
    if (DEMO_MODE) {
      const id  = `l-demo-${Date.now()}`
      const log: ImprovementActionLog = {
        ...item, id, created_at: new Date().toISOString(),
        result_type: 'pending', success: false, revenue_generated: 0,
      }
      set(s => ({ logs: [log, ...s.logs] }))
      return id
    }
    const { data } = await supabase.from('improvement_action_logs')
      .insert({ ...item, result_type: 'pending' }).select('id').single()
    await get().fetchLogs()
    return data?.id ?? ''
  },

  completeLog: async (id, success, revenue) => {
    const completedAt = new Date().toISOString()
    if (DEMO_MODE) {
      set(s => ({
        logs: s.logs.map(l =>
          l.id === id
            ? { ...l, completed_at: completedAt, result_type: success ? 'success' : 'fail' as const, success, revenue_generated: revenue }
            : l
        ),
      }))
      return
    }
    await supabase.from('improvement_action_logs')
      .update({ completed_at: completedAt, result_type: success ? 'success' : 'fail', success, revenue_generated: revenue })
      .eq('id', id)
    await get().fetchLogs()
  },

  addRevenueLink: async (item) => {
    if (DEMO_MODE) {
      const link: ImprovementRevenueLink = {
        ...item, id: `rl-demo-${Date.now()}`, created_at: new Date().toISOString(),
      }
      set(s => ({ revenueLinks: [link, ...s.revenueLinks] }))
      return
    }
    await supabase.from('improvement_revenue_links').insert(item)
    await get().fetchLogs()
  },

  getLinkedRevenue: (actionLogId) => {
    return get().revenueLinks
      .filter(l => l.action_log_id === actionLogId)
      .reduce((s, l) => s + l.revenue, 0)
  },

  runRevenueAttribution: async (customers) => {
    if (DEMO_MODE) {
      const { logs: attrLogs } = runAttributionDemo(get().logs, customers)
      // DEMO: revenue_generated_actual をメモリ上で更新
      set(s => ({
        logs: s.logs.map(l => {
          const match = attrLogs.find(a => a.actionLogId === l.id)
          if (!match) return l
          return {
            ...l,
            revenue_generated_actual: match.revenue,
            attribution_linked_at:    new Date().toISOString(),
            success:                  match.revenue > 0,
            result_type:              match.revenue > 0 ? 'success' : 'fail' as const,
          }
        }),
      }))
      return
    }
    await linkRevenueToActions()
    await get().fetchLogs()
  },

  getAccuracy: () => calcAccuracy(get().logs),

  getStats: () => {
    const { logs } = get()
    const map: Record<string, { success: number; total: number; revenue: number }> = {}

    for (const log of logs) {
      if (log.result_type === 'pending') continue
      if (!map[log.action_type]) map[log.action_type] = { success: 0, total: 0, revenue: 0 }
      map[log.action_type].total++
      if (log.success) {
        map[log.action_type].success++
        map[log.action_type].revenue += log.revenue_generated
      }
    }

    return (Object.entries(map) as [CoachActionType, { success: number; total: number; revenue: number }][])
      .map(([actionType, d]) => ({
        actionType,
        label:        ACTION_TYPE_LABEL[actionType],
        totalCount:   d.total,
        successCount: d.success,
        successRate:  d.total > 0 ? Math.round((d.success / d.total) * 100) : 0,
        avgRevenue:   d.success > 0 ? Math.round(d.revenue / d.success) : 0,
        totalRevenue: d.revenue,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
  },

  getMonthTotal: () => {
    const { logs } = get()
    const completed = logs.filter(l => l.result_type !== 'pending')
    return {
      totalRevenue:  completed.filter(l => l.success).reduce((s, l) => s + l.revenue_generated, 0),
      successCount:  completed.filter(l => l.success).length,
      totalCount:    completed.length,
    }
  },
}))

/**
 * RevenueAttributionEngine.ts  — Phase 4
 *
 * improvement_action_logs と customer_visits を自動紐付けし
 * AI提案が実際に売上へ繋がったか学習する。
 *
 * アトリビューションルール:
 *   - action の completed_at から7日以内
 *   - customer_name が一致する顧客の customer_visits
 *   - visit_date が completed_at 〜 +7日 に存在
 *
 * DEMO_MODE:
 *   CustomerRow の lastVisitDate と avgSpend を MOCK visits として利用。
 */

import { supabase, DEMO_MODE }    from '@/lib/supabase'
import type { ImprovementActionLog, ImprovementRevenueLink } from '@/types'
import type { CustomerRow }        from '@/store/useCustomerStore'

// ─── 型 ──────────────────────────────────────────────────────────────────────

export interface AttributionResult {
  linkedCount:   number
  totalRevenue:  number
  logs:          AttributionLog[]
}

export interface AttributionLog {
  actionLogId:   string
  customerId:    string | null
  visitId:       string | null
  revenue:       number
  matchedAt:     string
}

// ─── DEMO: CustomerRow から仮想 visit を生成 ──────────────────────────────────

interface MockVisit {
  customerId:   string
  customerName: string
  visitDate:    string
  revenue:      number
}

function buildMockVisits(customers: CustomerRow[]): MockVisit[] {
  return customers
    .filter(c => c.lastVisitDate)
    .map(c => ({
      customerId:   c.id,
      customerName: c.name,
      visitDate:    c.lastVisitDate!,
      revenue:      c.visitCount > 0 ? Math.round(c.totalSpent / c.visitCount) : 14000,
    }))
}

// ─── アトリビューション判定（7日ウィンドウ） ─────────────────────────────────

function isWithinWindow(completedAt: string, visitDate: string, windowDays = 7): boolean {
  const completed = new Date(completedAt).getTime()
  const visit     = new Date(visitDate).getTime()
  const window    = windowDays * 86400 * 1000
  return visit >= completed && visit <= completed + window
}

// ─── DEMO モード：メモリ上でアトリビューション ────────────────────────────────

export function runAttributionDemo(
  logs:      ImprovementActionLog[],
  customers: CustomerRow[],
): AttributionResult {
  const mockVisits = buildMockVisits(customers)
  const result: AttributionLog[] = []

  for (const log of logs) {
    if (!log.completed_at) continue
    if (log.revenue_generated_actual !== null && log.revenue_generated_actual !== undefined) continue

    // customer_name の一部一致で顧客を探す
    const targetNames = log.customer_name.split(/[,、・]/).map(n => n.trim()).filter(Boolean)

    for (const name of targetNames) {
      const visit = mockVisits.find(v =>
        (v.customerName.includes(name) || name.includes(v.customerName.split(/\s/)[0])) &&
        isWithinWindow(log.completed_at!, v.visitDate)
      )
      if (visit) {
        result.push({
          actionLogId:  log.id,
          customerId:   visit.customerId,
          visitId:      null,   // DEMO では visit_id なし
          revenue:      visit.revenue,
          matchedAt:    new Date().toISOString(),
        })
        break   // 1アクションにつき1マッチで十分
      }
    }
  }

  return {
    linkedCount:  result.length,
    totalRevenue: result.reduce((s, r) => s + r.revenue, 0),
    logs:         result,
  }
}

// ─── 本番モード：Supabase を使ったアトリビューション ─────────────────────────

export async function linkRevenueToActions(): Promise<AttributionResult> {
  // 未リンクの completed ログを取得
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: actionLogs, error: logsErr } = await supabase
    .from('improvement_action_logs')
    .select('*')
    .not('completed_at', 'is', null)
    .is('attribution_linked_at', null)
    .gte('created_at', since)

  if (logsErr || !actionLogs || actionLogs.length === 0) {
    return { linkedCount: 0, totalRevenue: 0, logs: [] }
  }

  const result: AttributionLog[] = []

  for (const log of actionLogs as ImprovementActionLog[]) {
    if (!log.completed_at) continue

    const windowEnd = new Date(new Date(log.completed_at).getTime() + 7 * 86400000).toISOString()

    // customer_name から customers.id を解決
    const targetNames = log.customer_name.split(/[,、・]/).map(n => n.trim()).filter(Boolean)
    for (const name of targetNames) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .ilike('name', `%${name.split(/\s/)[0]}%`)
        .limit(1)

      if (!customers || customers.length === 0) continue
      const customerId = customers[0].id

      // customer_visits を検索
      const { data: visits } = await supabase
        .from('customer_visits')
        .select('id, sales, visit_date')
        .eq('customer_id', customerId)
        .gte('visit_date', log.completed_at.slice(0, 10))
        .lte('visit_date', windowEnd.slice(0, 10))
        .limit(1)

      if (!visits || visits.length === 0) continue

      const visit   = visits[0]
      const revenue = visit.sales || 0

      // improvement_revenue_links に INSERT
      const link: Omit<ImprovementRevenueLink, 'id' | 'created_at'> = {
        action_log_id: log.id,
        customer_id:   customerId,
        visit_id:      visit.id,
        revenue,
      }
      await supabase.from('improvement_revenue_links').insert(link)

      result.push({
        actionLogId:  log.id,
        customerId,
        visitId:      visit.id,
        revenue,
        matchedAt:    new Date().toISOString(),
      })
      break
    }

    // action_log に attribution 済みフラグと実売上を更新
    const matched = result.filter(r => r.actionLogId === log.id)
    const actual  = matched.reduce((s, r) => s + r.revenue, 0)

    await supabase.from('improvement_action_logs').update({
      revenue_generated_actual: actual > 0 ? actual : 0,
      attribution_linked_at:    new Date().toISOString(),
      success:                  actual > 0,
      result_type:              actual > 0 ? 'success' : 'fail',
    }).eq('id', log.id)
  }

  return {
    linkedCount:  result.length,
    totalRevenue: result.reduce((s, r) => s + r.revenue, 0),
    logs:         result,
  }
}

// ─── 予測精度の計算 ───────────────────────────────────────────────────────────

export interface AccuracyMetrics {
  predictedTotal: number
  actualTotal:    number
  accuracyPct:    number   // actualTotal / predictedTotal * 100
  linkedCount:    number
  totalCount:     number
}

export function calcAccuracy(logs: ImprovementActionLog[]): AccuracyMetrics {
  const attributed = logs.filter(l =>
    l.revenue_generated_actual !== null && l.revenue_generated_actual !== undefined
  )
  const predictedTotal = attributed.reduce((s, l) => s + l.revenue_generated, 0)
  const actualTotal    = attributed.reduce((s, l) => s + (l.revenue_generated_actual ?? 0), 0)
  const accuracyPct    = predictedTotal > 0
    ? Math.min(100, Math.round((actualTotal / predictedTotal) * 100))
    : 0

  return {
    predictedTotal,
    actualTotal,
    accuracyPct,
    linkedCount: attributed.length,
    totalCount:  logs.filter(l => l.completed_at).length,
  }
}

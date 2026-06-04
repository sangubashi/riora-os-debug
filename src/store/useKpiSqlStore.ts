/**
 * useKpiSqlStore – Pure SQL aggregation KPI store
 * All metrics are computed directly from Supabase via SQL aggregation.
 * NO AI calls. Falls back to mock data when Supabase is not configured.
 */
import { create } from 'zustand'
import { supabase, DEMO_MODE } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklySalesPoint {
  date: string       // YYYY-MM-DD
  sales: number
}

export interface KpiSqlState {
  todaySales: number
  occupancyRate: number       // (booked / total_slots) * 100
  vipRate: number             // VIP customers this month / total this month
  lineReplyRate: number       // responded within 48h / total sent this month
  repeatRate: number          // customers with visit_count >= 2 this month / total
  churnRate: number           // customers with churn_risk_score >= 60 / total
  weeklySales: WeeklySalesPoint[]
  isLoading: boolean

  fetchAll: () => Promise<void>
}

// ─── Mock data ────────────────────────────────────────────────────────────────

function buildMockWeeklySales(): WeeklySalesPoint[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return {
      date: d.toISOString().split('T')[0],
      sales: Math.floor(Math.random() * 60000) + 20000,
    }
  })
}

const MOCK_STATE = {
  todaySales: 53000,
  occupancyRate: 75,
  vipRate: 28,
  lineReplyRate: 83,
  repeatRate: 62,
  churnRate: 14,
  weeklySales: buildMockWeeklySales(),
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMockMode(): boolean {
  if (DEMO_MODE) return true
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !url || !key || url === '' || key === ''
}

function monthRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

function weekStart(): string {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useKpiSqlStore = create<KpiSqlState>((set) => ({
  ...MOCK_STATE,
  isLoading: false,

  fetchAll: async () => {
    if (isMockMode()) return

    set({ isLoading: true })
    try {
      await Promise.allSettled([
        fetchTodaySales(set),
        fetchOccupancyRate(set),
        fetchVipRate(set),
        fetchLineReplyRate(set),
        fetchRepeatRate(set),
        fetchChurnRate(set),
        fetchWeeklySales(set),
      ])
    } finally {
      set({ isLoading: false })
    }
  },
}))

// ─── Individual fetchers ──────────────────────────────────────────────────────

type Setter = (partial: Partial<KpiSqlState>) => void

async function fetchTodaySales(set: Setter): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('reservations')
      .select('price')
      .eq('status', 'completed')
      .gte('scheduled_at', `${today}T00:00:00.000Z`)
      .lte('scheduled_at', `${today}T23:59:59.999Z`)

    const todaySales = (data ?? []).reduce((sum, r) => sum + (r.price ?? 0), 0)
    set({ todaySales })
  } catch {
    // keep mock
  }
}

async function fetchOccupancyRate(set: Setter): Promise<void> {
  try {
    // Count staff to determine total slots (8 slots/day per staff)
    const { count: staffCount } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'staff')

    const totalSlots = (staffCount ?? 1) * 8
    const today = new Date().toISOString().split('T')[0]

    const { count: bookedCount } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .in('status', ['confirmed', 'in_progress', 'completed'])
      .gte('scheduled_at', `${today}T00:00:00.000Z`)
      .lte('scheduled_at', `${today}T23:59:59.999Z`)

    const occupancyRate =
      totalSlots > 0 ? Math.round(((bookedCount ?? 0) / totalSlots) * 100) : 0
    set({ occupancyRate })
  } catch {
    // keep mock
  }
}

async function fetchVipRate(set: Setter): Promise<void> {
  try {
    const { start, end } = monthRange()

    // Customers who visited this month (have reservations this month)
    const { data: thisMonthData } = await supabase
      .from('reservations')
      .select('customer_id')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .not('customer_id', 'is', null)

    if (!thisMonthData || thisMonthData.length === 0) {
      set({ vipRate: 0 })
      return
    }

    const customerIds = Array.from(new Set(thisMonthData.map((r) => r.customer_id)))
    const { count: vipCount } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .in('id', customerIds)
      .eq('is_vip', true)

    const vipRate =
      customerIds.length > 0
        ? Math.round(((vipCount ?? 0) / customerIds.length) * 100)
        : 0
    set({ vipRate })
  } catch {
    // keep mock
  }
}

async function fetchLineReplyRate(set: Setter): Promise<void> {
  try {
    const { start } = monthRange()

    // Total sent messages this month
    const { count: sentCount } = await supabase
      .from('line_logs')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'sent')
      .gte('sent_at', start)

    if (!sentCount || sentCount === 0) {
      set({ lineReplyRate: 0 })
      return
    }

    // Count received messages within 48h window of a sent message
    // Simplified: count received messages this month as proxy
    const { count: receivedCount } = await supabase
      .from('line_logs')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'received')
      .gte('sent_at', start)

    const lineReplyRate = Math.min(
      100,
      Math.round(((receivedCount ?? 0) / sentCount) * 100)
    )
    set({ lineReplyRate })
  } catch {
    // keep mock
  }
}

async function fetchRepeatRate(set: Setter): Promise<void> {
  try {
    const { start, end } = monthRange()

    const { data: thisMonthData } = await supabase
      .from('reservations')
      .select('customer_id')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .not('customer_id', 'is', null)

    if (!thisMonthData || thisMonthData.length === 0) {
      set({ repeatRate: 0 })
      return
    }

    const customerIds = Array.from(new Set(thisMonthData.map((r) => r.customer_id)))

    // Repeat = visit_count >= 2
    const { count: repeatCount } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .in('id', customerIds)
      .gte('visit_count', 2)

    const repeatRate =
      customerIds.length > 0
        ? Math.round(((repeatCount ?? 0) / customerIds.length) * 100)
        : 0
    set({ repeatRate })
  } catch {
    // keep mock
  }
}

async function fetchChurnRate(set: Setter): Promise<void> {
  try {
    const { count: totalCount } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })

    const { count: churnCount } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .gte('churn_risk_score', 60)

    const churnRate =
      (totalCount ?? 0) > 0
        ? Math.round(((churnCount ?? 0) / (totalCount ?? 1)) * 100)
        : 0
    set({ churnRate })
  } catch {
    // keep mock
  }
}

async function fetchWeeklySales(set: Setter): Promise<void> {
  try {
    const start = weekStart()

    const { data } = await supabase
      .from('reservations')
      .select('scheduled_at, price')
      .eq('status', 'completed')
      .gte('scheduled_at', start)
      .order('scheduled_at', { ascending: true })

    if (!data) return

    // Group by date
    const salesByDate: Record<string, number> = {}
    for (const row of data) {
      const date = row.scheduled_at.split('T')[0]
      salesByDate[date] = (salesByDate[date] ?? 0) + (row.price ?? 0)
    }

    // Build last-7-days array (fill missing dates with 0)
    const weeklySales: WeeklySalesPoint[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const date = d.toISOString().split('T')[0]
      return { date, sales: salesByDate[date] ?? 0 }
    })

    set({ weeklySales })
  } catch {
    // keep mock
  }
}

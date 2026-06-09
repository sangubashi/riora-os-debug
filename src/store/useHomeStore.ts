/**
 * useHomeStore – Home screen Zustand store
 * Queries Supabase for today's reservations, KPI, and churn risk count.
 * Falls back to mock data when Supabase is not configured.
 */
import { create } from 'zustand'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import type { ReservationWithCustomer } from '@/types/database'
import type { UserRole } from '@/types/database'

// ─── Mock data ───────────────────────────────────────────────────────────────

function todayAt(h: number, m = 0): string {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const MOCK_RESERVATIONS: ReservationWithCustomer[] = [
  {
    id: 'r-1',
    customer_id: 'c-1',
    staff_id: 'staff-mock',
    menu: 'プレミアムエイジングケア',
    price: 18000,
    scheduled_at: todayAt(10, 0),
    duration_minutes: 90,
    status: 'confirmed',
    is_new_customer: false,
    notes: null,
    created_at: new Date().toISOString(),
    customer: {
      name: '田中 美咲',
      customer_type: 'VIP型',
      is_vip: true,
      visit_count: 8,
      churn_risk_score: 12,
      last_visit_date: new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
      total_spent: 0,
    },
  },
  {
    id: 'r-2',
    customer_id: 'c-2',
    staff_id: 'staff-mock',
    menu: 'モイスチャーフェイシャル',
    price: 12000,
    scheduled_at: todayAt(11, 30),
    duration_minutes: 60,
    status: 'confirmed',
    is_new_customer: false,
    notes: null,
    created_at: new Date().toISOString(),
    customer: {
      name: '鈴木 花子',
      customer_type: '感情重視型',
      is_vip: false,
      visit_count: 3,
      churn_risk_score: 18,
      last_visit_date: new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0],
      total_spent: 0,
    },
  },
  {
    id: 'r-3',
    customer_id: 'c-3',
    staff_id: 'staff-mock',
    menu: 'ポアクリーニング + 美白ケア',
    price: 15000,
    scheduled_at: todayAt(13, 0),
    duration_minutes: 75,
    status: 'in_progress',
    is_new_customer: false,
    notes: null,
    created_at: new Date().toISOString(),
    customer: {
      name: '佐藤 明子',
      customer_type: '効果重視型',
      is_vip: false,
      visit_count: 9,
      churn_risk_score: 22,
      last_visit_date: new Date(Date.now() - 18 * 86400000).toISOString().split('T')[0],
      total_spent: 0,
    },
  },
  {
    id: 'r-4',
    customer_id: 'c-4',
    staff_id: 'staff-mock',
    menu: 'ベーシックフェイシャル',
    price: 8000,
    scheduled_at: todayAt(14, 30),
    duration_minutes: 60,
    status: 'confirmed',
    is_new_customer: false,
    notes: null,
    created_at: new Date().toISOString(),
    customer: {
      name: '山田 美沙',
      customer_type: '慎重・不安型',
      is_vip: false,
      visit_count: 5,
      churn_risk_score: 76,
      last_visit_date: new Date(Date.now() - 62 * 86400000).toISOString().split('T')[0],
      total_spent: 0,
    },
  },
  {
    id: 'r-5',
    customer_id: 'c-5',
    staff_id: 'staff-mock',
    menu: 'プレミアムエイジングケア',
    price: 18000,
    scheduled_at: todayAt(16, 0),
    duration_minutes: 90,
    status: 'completed',
    is_new_customer: false,
    notes: null,
    created_at: new Date().toISOString(),
    customer: {
      name: '高橋 ゆり',
      customer_type: 'VIP型',
      is_vip: true,
      visit_count: 18,
      churn_risk_score: 5,
      last_visit_date: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
      total_spent: 0,
    },
  },
]

const MOCK_TODAY_SALES = MOCK_RESERVATIONS.filter(r => r.status === 'completed').reduce(
  (sum, r) => sum + r.price,
  0
)
const MOCK_YESTERDAY_SALES = 42000
const MOCK_CHURN_RISK_COUNT = 3

// ─── Store types ──────────────────────────────────────────────────────────────

interface HomeState {
  reservations: ReservationWithCustomer[]
  todaySales: number
  yesterdaySales: number
  churnRiskCount: number
  isLoading: boolean

  fetchTodayReservations: (role: UserRole, uid: string) => Promise<void>
  fetchTodayKpi: () => Promise<void>
  fetchChurnRiskCount: () => Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMockMode(): boolean {
  if (DEMO_MODE) return true
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !url || !key || url === '' || key === ''
}

function todayRange(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useHomeStore = create<HomeState>((set) => ({
  reservations:   DEMO_MODE ? MOCK_RESERVATIONS  : [],
  todaySales:     DEMO_MODE ? MOCK_TODAY_SALES   : 0,
  yesterdaySales: DEMO_MODE ? MOCK_YESTERDAY_SALES : 0,
  churnRiskCount: DEMO_MODE ? MOCK_CHURN_RISK_COUNT : 0,
  isLoading: false,

  fetchTodayReservations: async (role: UserRole, uid: string) => {
    if (isMockMode()) return

    set({ isLoading: true })
    try {
      const { start, end } = todayRange()

      let query = supabase
        .from('reservations')
        .select(
          `
          id,
          customer_id,
          staff_id,
          menu,
          price,
          scheduled_at,
          duration_minutes,
          status,
          is_new_customer,
          notes,
          created_at,
          customer:customers (
            name,
            customer_type,
            is_vip,
            visit_count,
            churn_risk_score,
            last_visit_date,
            total_spent
          )
        `
        )
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .order('scheduled_at', { ascending: true })

      // Staff sees only their own; owner sees all
      if (role === 'staff') {
        query = query.eq('staff_id', uid)
      }

      const { data, error } = await query.limit(50)

      if (error || !data) return

      // Supabase returns the related record as an object when joined via FK
      const mapped = (data as unknown as ReservationWithCustomer[]).filter(
        (r) => r.customer != null
      )

      set({ reservations: mapped })
    } catch {
      // Fallback to mock on error
    } finally {
      set({ isLoading: false })
    }
  },

  fetchTodayKpi: async () => {
    if (isMockMode()) return

    try {
      const { data, error } = await supabase
        .from('kpi_today')
        .select('today_sales, yesterday_sales')
        .single()

      if (error || !data) return

      set({
        todaySales: Number(data.today_sales ?? 0),
        yesterdaySales: Number(data.yesterday_sales ?? 0),
      })
    } catch {
      // Fallback to mock on error
    }
  },

  fetchChurnRiskCount: async () => {
    if (isMockMode()) return

    try {
      const { count, error } = await supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .gt('churn_risk_score', 60)

      if (error) return

      set({ churnRiskCount: count ?? 0 })
    } catch {
      // Fallback to mock on error
    }
  },
}))

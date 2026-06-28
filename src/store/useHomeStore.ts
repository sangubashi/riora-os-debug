import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { ReservationWithCustomer } from '@/types/database'
import type { UserRole } from '@/types/database'

// ─── Store types ──────────────────────────────────────────────────────────────

interface HomeState {
  reservations: ReservationWithCustomer[]
  isFallback:   boolean
  isLoading:    boolean

  fetchTodayReservations: (role: UserRole, uid: string) => Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayRange(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

const RESERVATION_SELECT = `
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

// ─── Store ────────────────────────────────────────────────────────────────────

export const useHomeStore = create<HomeState>((set) => ({
  reservations: [],
  isFallback:   false,
  isLoading:    false,

  fetchTodayReservations: async (role: UserRole, uid: string) => {
    set({ isLoading: true })
    try {
      const { start, end } = todayRange()

      let query = supabase
        .from('reservations')
        .select(RESERVATION_SELECT)
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .order('scheduled_at', { ascending: true })

      if (role === 'staff') {
        query = query.eq('staff_id', uid)
      }

      const { data, error } = await query.limit(50)
      if (error) return

      let mapped = ((data ?? []) as unknown as ReservationWithCustomer[]).filter(
        (r) => r.customer != null
      )
      let isFallback = false

      if (mapped.length === 0) {
        let fallbackQuery = supabase
          .from('reservations')
          .select(RESERVATION_SELECT)
          .order('scheduled_at', { ascending: false })
          .limit(5)

        if (role === 'staff') {
          fallbackQuery = fallbackQuery.eq('staff_id', uid)
        }

        const { data: fallbackData, error: fallbackError } = await fallbackQuery

        if (!fallbackError && fallbackData) {
          mapped = (fallbackData as unknown as ReservationWithCustomer[])
            .filter((r) => r.customer != null)
            .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
          isFallback = mapped.length > 0
        }
      }

      set({ reservations: mapped, isFallback })
    } catch {
      // silent: reservations stay empty
    } finally {
      set({ isLoading: false })
    }
  },
}))

// ============================================================
// Riora OS – Database TypeScript types
// ============================================================

export type UserRole = 'owner' | 'staff'
export type ReservationStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
export type LineDirection = 'sent' | 'received'

export interface Profile {
  id: string
  role: UserRole
  staff_name: string
  display_name: string | null
  created_at: string
}

export interface Customer {
  id: string
  name: string
  name_kana: string | null
  phone: string | null
  email: string | null
  customer_type: string
  is_vip: boolean
  visit_count: number
  total_spent: number
  last_visit_date: string | null
  next_visit_date: string | null
  churn_risk_score: number
  assigned_staff_id: string | null
  memo: string | null
  created_at: string
  updated_at: string
}

export interface Reservation {
  id: string
  customer_id: string
  staff_id: string
  menu: string
  price: number
  scheduled_at: string
  duration_minutes: number
  status: ReservationStatus
  is_new_customer: boolean
  notes: string | null
  created_at: string
}

export interface ReservationWithCustomer extends Reservation {
  customer: Pick<
    Customer,
    'name' | 'customer_type' | 'is_vip' | 'visit_count' | 'churn_risk_score' | 'last_visit_date'
  >
}

export interface StaffLog {
  id: string
  customer_id: string
  staff_id: string
  reservation_id: string | null
  log_text: string | null
  services_done: string[]
  next_visit_recommended_at: string | null
  created_at: string
}

export interface AiTagRow {
  id: string
  customer_id: string
  tags: string[]
  dry_skin: boolean
  uv_sensitive: boolean
  sales_hate: boolean
  vip: boolean
  repeat_high: boolean
  updated_at: string
}

export interface LineLog {
  id: string
  customer_id: string | null
  staff_id: string
  direction: LineDirection
  message: string
  template_id: string | null
  sent_at: string
}

export interface TemplateCategory {
  id: string
  name: string
  sort_order: number
}

export interface LineTemplate {
  id: string
  category_id: string
  title: string
  body: string
  tags: string[]
  use_count: number
  is_active: boolean
  created_at: string
}

export interface AuditViewLog {
  id: string
  viewer_id: string
  customer_id: string | null
  viewed_at: string
}

export interface AuditEditLog {
  id: string
  editor_id: string
  customer_id: string | null
  action: string
  diff: Record<string, unknown> | null
  edited_at: string
}

export interface AuditCsvLog {
  id: string
  exporter_id: string
  record_count: number | null
  filters: Record<string, unknown> | null
  exported_at: string
}

// KPI view row shape
export interface KpiTodayRow {
  today_sales: number
  yesterday_sales: number
  today_reservations: number
  today_booked: number
  today_completed: number
}

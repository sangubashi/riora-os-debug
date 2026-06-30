/**
 * canAccessCustomer.ts — AUTH-1 共通アクセス判定
 *
 * ルール A: assigned_staff_id = staffBrainId → 常時閲覧可
 * ルール B: 本日の予約担当                  → 当日のみ閲覧可
 * ルール C: assigned_staff_id IS NULL       → 全スタッフ閲覧可
 * 管理者(isAdmin=true)                      → 常時全件閲覧可
 *
 * 注意: サーバーサイド専用（service role キー使用）
 */
import { createClient } from '@supabase/supabase-js'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function canAccessCustomer(
  staffBrainId: string | null,
  customerId:   string,
  isAdmin = false
): Promise<boolean> {
  if (isAdmin) return true

  const supabase = getServerClient()

  const { data: customer } = await supabase
    .from('brain_customers')
    .select('assigned_staff_id')
    .eq('id', customerId)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)
    .single()

  if (!customer) return false

  // Rule C: 店舗共有
  if (customer.assigned_staff_id === null) return true

  // Rule A: 担当顧客
  if (staffBrainId && customer.assigned_staff_id === staffBrainId) return true

  // Rule B: 本日の予約担当
  if (staffBrainId) {
    const today = new Date().toISOString().split('T')[0]
    const { data: bookings } = await supabase
      .from('reservations')
      .select('id')
      .eq('brain_customer_id', customerId)
      .eq('staff_id', staffBrainId)
      .gte('scheduled_at', `${today}T00:00:00.000Z`)
      .lte('scheduled_at', `${today}T23:59:59.999Z`)
      .neq('status', 'cancelled')
      .limit(1)

    if (bookings && bookings.length > 0) return true
  }

  return false
}

/**
 * 顧客リスト用: アクセス可能な顧客 ID セットを一括取得
 * canAccessCustomer を個別に N 回呼ぶより高速
 */
export async function filterAccessibleCustomerIds(
  customerIds: string[],
  staffBrainId: string | null,
  isAdmin: boolean
): Promise<Set<string>> {
  if (isAdmin) return new Set(customerIds)
  if (customerIds.length === 0) return new Set()

  const supabase = getServerClient()

  // 全顧客の assigned_staff_id を一括取得
  const { data: customers } = await supabase
    .from('brain_customers')
    .select('id, assigned_staff_id')
    .in('id', customerIds)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)

  if (!customers) return new Set()

  const accessible = new Set<string>()
  const needsBookingCheck: string[] = []

  for (const c of customers) {
    if (c.assigned_staff_id === null) {
      // Rule C
      accessible.add(c.id)
    } else if (staffBrainId && c.assigned_staff_id === staffBrainId) {
      // Rule A
      accessible.add(c.id)
    } else if (staffBrainId) {
      // Rule B 候補（予約確認が必要）
      needsBookingCheck.push(c.id)
    }
  }

  // Rule B: 本日予約担当を一括確認
  if (staffBrainId && needsBookingCheck.length > 0) {
    const today = new Date().toISOString().split('T')[0]
    const { data: bookings } = await supabase
      .from('reservations')
      .select('brain_customer_id')
      .in('brain_customer_id', needsBookingCheck)
      .eq('staff_id', staffBrainId)
      .gte('scheduled_at', `${today}T00:00:00.000Z`)
      .lte('scheduled_at', `${today}T23:59:59.999Z`)
      .neq('status', 'cancelled')

    for (const b of (bookings ?? [])) {
      accessible.add(b.brain_customer_id)
    }
  }

  return accessible
}

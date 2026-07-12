/**
 * canAccessCustomer.ts — AUTH-1 V2 共通アクセス判定
 *
 * ルール A': brain_visits の直近来店(visit_date最新)の staff_id = staffBrainId → 常時閲覧可
 * ルール B': 本日の予約担当（reservations.staff_id は auth.users.id 空間のため、
 *            brain_staff.user_id 経由で brain_staff.id へ変換した上で比較）      → 当日のみ閲覧可
 * ルール C : 来店履歴なし かつ 本日予約なし                                      → 全スタッフ閲覧可
 * 管理者(isAdmin=true)                                                          → 常時全件閲覧可
 *
 * 設計根拠: docs/AUTH1_V2_DESIGN.md
 *   旧Rule A(assigned_staff_id一致)は書き込み経路が存在せず54%しか埋まらないため廃止。
 *   旧Rule B(reservations.staff_idとstaffBrainIdの直接比較)はID空間不一致
 *   (reservations.staff_id=auth.users.id、staffBrainId=brain_staff.id)により
 *   常に不成立だったため、brain_staff.user_id を介した変換を追加。
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

function todayRangeUtc(): { start: string; end: string } {
  const today = new Date().toISOString().split('T')[0]
  return { start: `${today}T00:00:00.000Z`, end: `${today}T23:59:59.999Z` }
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
    .select('id')
    .eq('id', customerId)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)
    .single()

  if (!customer) return false

  const { start, end } = todayRangeUtc()

  const [visitRes, bookingsRes] = await Promise.all([
    supabase
      .from('brain_visits')
      .select('staff_id')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('reservations')
      .select('id, staff_id')
      .eq('brain_customer_id', customerId)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .neq('status', 'cancelled'),
  ])

  const latestVisit    = visitRes.data
  const todaysBookings = bookingsRes.data ?? []

  // Rule A': 直近来店の担当が自分
  if (latestVisit && staffBrainId && latestVisit.staff_id === staffBrainId) return true

  // Rule B': 本日の予約担当（reservations.staff_id(auth.users.id) を
  // brain_staff.user_id 経由で brain_staff.id に変換してから比較）
  if (staffBrainId && todaysBookings.length > 0) {
    const bookingStaffAuthIds = Array.from(
      new Set(todaysBookings.map(b => b.staff_id).filter((v): v is string => !!v))
    )
    if (bookingStaffAuthIds.length > 0) {
      const { data: matchedStaff } = await supabase
        .from('brain_staff')
        .select('id')
        .eq('id', staffBrainId)
        .in('user_id', bookingStaffAuthIds)
        .maybeSingle()
      if (matchedStaff) return true
    }
  }

  // Rule C: 来店履歴なし かつ 本日予約なし → 店舗共有
  if (!latestVisit && todaysBookings.length === 0) return true

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

  const { data: customers } = await supabase
    .from('brain_customers')
    .select('id')
    .in('id', customerIds)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)

  if (!customers || customers.length === 0) return new Set()
  const validIds = customers.map(c => c.id)

  const { start, end } = todayRangeUtc()

  const [visitsRes, bookingsRes, meRes] = await Promise.all([
    // 顧客ごとの直近来店を一括取得（visit_date降順。customer_idごとに最初の行が最新）
    supabase
      .from('brain_visits')
      .select('customer_id, staff_id, visit_date')
      .in('customer_id', validIds)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false }),
    // 本日の予約を一括取得
    supabase
      .from('reservations')
      .select('brain_customer_id, staff_id')
      .in('brain_customer_id', validIds)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .neq('status', 'cancelled'),
    // 自分(staffBrainId)の auth.users.id を解決（Rule B'比較用。一度だけ変換すれば済む）
    staffBrainId
      ? supabase.from('brain_staff').select('user_id').eq('id', staffBrainId).maybeSingle()
      : Promise.resolve({ data: null } as { data: { user_id: string } | null }),
  ])

  const latestStaffByCustomer = new Map<string, string>()
  for (const v of (visitsRes.data ?? [])) {
    if (!latestStaffByCustomer.has(v.customer_id)) {
      latestStaffByCustomer.set(v.customer_id, v.staff_id)
    }
  }

  const bookingsByCustomer = new Map<string, string[]>()
  for (const b of (bookingsRes.data ?? [])) {
    const list = bookingsByCustomer.get(b.brain_customer_id) ?? []
    if (b.staff_id) list.push(b.staff_id)
    bookingsByCustomer.set(b.brain_customer_id, list)
  }

  const myAuthUserId = meRes.data?.user_id ?? null

  const accessible = new Set<string>()
  for (const id of validIds) {
    const latestStaff        = latestStaffByCustomer.get(id)
    const todaysBookingStaff = bookingsByCustomer.get(id) ?? []

    // Rule A'
    if (latestStaff && staffBrainId && latestStaff === staffBrainId) {
      accessible.add(id)
      continue
    }
    // Rule B'
    if (myAuthUserId && todaysBookingStaff.includes(myAuthUserId)) {
      accessible.add(id)
      continue
    }
    // Rule C
    if (!latestStaff && todaysBookingStaff.length === 0) {
      accessible.add(id)
    }
  }

  return accessible
}

/**
 * GET /api/notifications — アプリ内通知 v1(検出のみ・読み取り専用)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md 準拠。
 * notificationsテーブルは作らない(migration禁止のため)。既存テーブルから
 * 都度計算するステートレス設計。既読/未読・7日expireはクライアント側の
 * 一時状態(useNotificationsStore)で扱う。
 *
 * AUTH-2準拠: スタッフは自分の担当顧客(assigned_staff_id=自分)の通知のみ。
 * 管理者は全顧客を対象にスキャンする。
 * 離脱予兆・売上・承認待ち等の管理者向け通知(設計書§1)はこのv1では未実装。
 *
 * 社内利用者除外(docs/NOTIFICATION_INTERNAL_USER_EXCLUSION.md): brain_customers.
 * is_internal_userがtrueの顧客(スタッフ本人の試用・検証購入記録)は、権限に関わらず
 * (管理者含め)全通知種別から除外する。AUTH-2の担当スコープとは直交する別軸のため、
 * 各顧客取得箇所でAUTH-2スコープとは独立に適用する。
 */
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient } from '../../lib/repos'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { normalizeProductName } from '../customers/[id]/homecare-products/route'
import { detectNotifications, type NotificationCustomerInput } from '@/lib/notifications/detectNotifications'
import { buildVisitReminders, type VisitReminderInput } from '@/lib/notifications/detectVisitReminders'
import { buildNewReservationNotifications, type NewReservationInput } from '@/lib/notifications/detectNewReservations'
import { todayJst, tomorrowJst } from '../today-briefing/route'
import { resolveLegacyCustomerIds } from '@/lib/resolveLegacyCustomerIds'
import type { StaffNotification } from '@/types/notifications'

/** is_internal_user=trueの顧客IDセット。全通知種別・全ロール(管理者含む)へ一律適用する。 */
async function getInternalUserIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('brain_customers')
    .select('id')
    .eq('is_internal_user', true)
  if (error) throw new Error(`getInternalUserIds failed: ${error.message}`)
  return new Set((data ?? []).map((r: { id: string }) => r.id))
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getServiceClient()
    const internalUserIds = await getInternalUserIds(supabase)

    // 注意: この customers は「担当顧客(assigned_staff_id)」の一覧であり、後段の
    // 来店リマインドが対象とする「予約担当(reservations.staff_id)」とは範囲が異なる
    // (代打・引き継ぎ等でassigned_staff_idと予約担当が食い違うケースがあるため)。
    // customersが0件でも来店リマインドは独立して動く必要があるため、ここでは
    // 早期returnしない。
    let customerQuery = supabase
      .from('brain_customers')
      .select('id, name, wedding_date, first_visit_date, assigned_staff_id')
      .is('deleted_at', null)

    if (!staff.isAdmin) {
      customerQuery = staff.staffBrainId
        ? customerQuery.eq('assigned_staff_id', staff.staffBrainId)
        : customerQuery.eq('id', '00000000-0000-0000-0000-000000000000') // 0件を保証するダミー条件
    }

    const { data: customersData, error: customerError } = await customerQuery
    if (customerError) {
      return NextResponse.json({ success: false, error: customerError.message }, { status: 500 })
    }
    // 社内利用者(is_internal_user=true)は誕生日/記念日/ホームケア/久しぶり来店の対象から除外。
    const customers = (customersData ?? []).filter((c) => !internalUserIds.has(c.id))
    const customerIds = customers.map((c) => c.id)

    let notifications: ReturnType<typeof detectNotifications> = []
    if (customerIds.length > 0) {
      const [visitsRes, memoriesRes, skinRes, reservationsRes] = await Promise.all([
        supabase
          .from('brain_visits')
          .select('customer_id, visit_date, retail_category')
          .in('customer_id', customerIds)
          .is('deleted_at', null)
          .order('visit_date', { ascending: true }),
        supabase
          .from('customer_memories')
          .select('customer_id, memory_type, trigger_date, content')
          .in('customer_id', customerIds)
          .eq('memory_type', 'anniversary')
          .not('trigger_date', 'is', null),
        supabase
          .from('brain_skin_records')
          .select('customer_id, primary_delta, created_at')
          .in('customer_id', customerIds)
          .order('created_at', { ascending: true }),
        supabase
          .from('reservations')
          .select('brain_customer_id, scheduled_at')
          .in('brain_customer_id', customerIds)
          .not('brain_customer_id', 'is', null),
      ])

      if (visitsRes.error) return NextResponse.json({ success: false, error: visitsRes.error.message }, { status: 500 })
      if (memoriesRes.error) return NextResponse.json({ success: false, error: memoriesRes.error.message }, { status: 500 })
      if (skinRes.error) return NextResponse.json({ success: false, error: skinRes.error.message }, { status: 500 })
      if (reservationsRes.error) return NextResponse.json({ success: false, error: reservationsRes.error.message }, { status: 500 })

      type VisitRow = { customer_id: string; visit_date: string; retail_category: string | null }
      const visits = (visitsRes.data ?? []) as VisitRow[]

      const productCountsByCustomer = new Map<string, Map<string, { count: number; lastPurchasedAt: string }>>()
      const nearbyDatesByCustomer = new Map<string, string[]>()
      const lastVisitByCustomer = new Map<string, string>()
      for (const v of visits) {
        lastVisitByCustomer.set(v.customer_id, v.visit_date) // 昇順取得なので最後の代入が最新来店
        const dates = nearbyDatesByCustomer.get(v.customer_id) ?? []
        dates.push(v.visit_date)
        nearbyDatesByCustomer.set(v.customer_id, dates)

        if (!v.retail_category) continue
        const names = v.retail_category.split('/').map((n) => normalizeProductName(n)).filter(Boolean)
        const map = productCountsByCustomer.get(v.customer_id) ?? new Map()
        for (const name of names) {
          const ex = map.get(name)
          if (ex) {
            ex.count += 1
            if (v.visit_date > ex.lastPurchasedAt) ex.lastPurchasedAt = v.visit_date
          } else {
            map.set(name, { count: 1, lastPurchasedAt: v.visit_date })
          }
        }
        productCountsByCustomer.set(v.customer_id, map)
      }

      type ReservationRow = { brain_customer_id: string; scheduled_at: string }
      for (const r of (reservationsRes.data ?? []) as ReservationRow[]) {
        const dates = nearbyDatesByCustomer.get(r.brain_customer_id) ?? []
        dates.push(r.scheduled_at)
        nearbyDatesByCustomer.set(r.brain_customer_id, dates)
      }

      type MemoryRow = { customer_id: string; memory_type: string; trigger_date: string | null; content: string }
      const memories = (memoriesRes.data ?? []) as MemoryRow[]
      const memoriesByCustomer = new Map<string, MemoryRow[]>()
      for (const m of memories) {
        const list = memoriesByCustomer.get(m.customer_id) ?? []
        list.push(m)
        memoriesByCustomer.set(m.customer_id, list)
      }

      type SkinRow = { customer_id: string; primary_delta: number | null; created_at: string }
      const skinRows = (skinRes.data ?? []) as SkinRow[]
      const skinByCustomer = new Map<string, number[]>()
      for (const s of skinRows) {
        if (s.primary_delta === null) continue
        const list = skinByCustomer.get(s.customer_id) ?? []
        list.push(s.primary_delta)
        skinByCustomer.set(s.customer_id, list)
      }

      const inputs: NotificationCustomerInput[] = customers.map((c) => ({
        id: c.id,
        name: c.name,
        weddingDate: c.wedding_date,
        firstVisitDate: c.first_visit_date,
        lastVisitDate: lastVisitByCustomer.get(c.id) ?? null,
        memories: (memoriesByCustomer.get(c.id) ?? []).map((m) => ({
          memoryType: m.memory_type,
          triggerDate: m.trigger_date,
          content: m.content,
        })),
        retailProductCounts: productCountsByCustomer.get(c.id) ?? new Map(),
        skinPrimaryDeltas: skinByCustomer.get(c.id) ?? [],
        nearbyVisitDates: nearbyDatesByCustomer.get(c.id) ?? [],
      }))

      notifications = detectNotifications(inputs)
    }

    // ── 🔔 来店リマインド(§3-4): 前日〜当日の予約×担当本人 ──────────────────
    // AUTH-2準拠: reservations.staff_id(auth.users.id空間)で絞る。
    // today-briefingと同じ判定基準(staff_id一致)を使い、整合性を取る。
    const { start: todayStart } = todayJst()
    const { end: tomorrowEnd } = tomorrowJst()
    let reminderQuery = supabase
      .from('reservations')
      .select('id, brain_customer_id, staff_id, scheduled_at, created_at')
      .not('brain_customer_id', 'is', null)
      .gte('scheduled_at', todayStart)
      .lte('scheduled_at', tomorrowEnd)

    if (!staff.isAdmin) {
      reminderQuery = reminderQuery.eq('staff_id', staff.authUserId)
    }

    const { data: upcomingReservations, error: reminderError } = await reminderQuery
    if (reminderError) {
      return NextResponse.json({ success: false, error: reminderError.message }, { status: 500 })
    }

    let visitReminders: ReturnType<typeof buildVisitReminders> = []
    if (upcomingReservations && upcomingReservations.length > 0) {
      type UpcomingRow = { id: string; brain_customer_id: string; staff_id: string; scheduled_at: string; created_at: string }
      // 社内利用者の予約は来店リマインドの対象外。
      const rows = (upcomingReservations as UpcomingRow[]).filter(
        (r) => !internalUserIds.has(r.brain_customer_id)
      )
      const reminderCustomerIds = Array.from(new Set(rows.map((r) => r.brain_customer_id)))

      // 注意: reservations.staff_id(その予約の担当)は brain_customers.assigned_staff_id
      // (通常の担当)と必ずしも一致しない(代打・引き継ぎ等)。そのため customers/
      // lastVisitByCustomer(assigned_staff_id基準で絞り込み済み)を再利用せず、
      // reminderCustomerIds専用に氏名・最終来店日を取り直す。
      const [reminderCustomersRes, reminderVisitsRes, legacyIdsEntries] = await Promise.all([
        supabase.from('brain_customers').select('id, name').in('id', reminderCustomerIds),
        supabase
          .from('brain_visits')
          .select('customer_id, visit_date')
          .in('customer_id', reminderCustomerIds)
          .is('deleted_at', null)
          .order('visit_date', { ascending: true }),
        Promise.all(
          reminderCustomerIds.map(async (cid) => [cid, await resolveLegacyCustomerIds(supabase, cid)] as const)
        ),
      ])

      if (reminderCustomersRes.error) return NextResponse.json({ success: false, error: reminderCustomersRes.error.message }, { status: 500 })
      if (reminderVisitsRes.error) return NextResponse.json({ success: false, error: reminderVisitsRes.error.message }, { status: 500 })

      const nameById = new Map((reminderCustomersRes.data ?? []).map((c) => [c.id, c.name]))
      const legacyIdsByCustomer = new Map(legacyIdsEntries)
      const allLegacyIds = Array.from(new Set(Array.from(legacyIdsByCustomer.values()).flat()))

      type ReminderVisitRow = { customer_id: string; visit_date: string }
      const reminderLastVisitByCustomer = new Map<string, string>()
      for (const v of (reminderVisitsRes.data ?? []) as ReminderVisitRow[]) {
        reminderLastVisitByCustomer.set(v.customer_id, v.visit_date) // 昇順取得なので最後の代入が最新
      }

      const [contraRes, remindMemoriesRes] = await Promise.all([
        allLegacyIds.length > 0
          ? supabase
              .from('contraindications')
              .select('customer_id, severity, title, description')
              .in('customer_id', allLegacyIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('customer_memories')
          .select('customer_id, content, importance, is_sensitive, created_at')
          .in('customer_id', reminderCustomerIds)
          .eq('is_sensitive', false)
          .order('created_at', { ascending: false }),
      ])

      if (contraRes.error) return NextResponse.json({ success: false, error: contraRes.error.message }, { status: 500 })
      if (remindMemoriesRes.error) return NextResponse.json({ success: false, error: remindMemoriesRes.error.message }, { status: 500 })

      type ContraRow = { customer_id: string; severity: string; title: string; description: string | null }
      const contraByLegacyId = new Map<string, ContraRow[]>()
      for (const c of (contraRes.data ?? []) as ContraRow[]) {
        const list = contraByLegacyId.get(c.customer_id) ?? []
        list.push(c)
        contraByLegacyId.set(c.customer_id, list)
      }

      type RemindMemoryRow = { customer_id: string; content: string; importance: string; is_sensitive: boolean; created_at: string }
      const memoriesByCustomerFull = new Map<string, RemindMemoryRow[]>()
      for (const m of (remindMemoriesRes.data ?? []) as RemindMemoryRow[]) {
        const list = memoriesByCustomerFull.get(m.customer_id) ?? []
        list.push(m)
        memoriesByCustomerFull.set(m.customer_id, list)
      }

      const reminderInputs: VisitReminderInput[] = rows.map((r) => {
        const legacyIds = legacyIdsByCustomer.get(r.brain_customer_id) ?? []
        const contraindications = legacyIds.flatMap((lid) => contraByLegacyId.get(lid) ?? [])
        const allMemories = memoriesByCustomerFull.get(r.brain_customer_id) ?? []
        return {
          reservationId: r.id,
          customerId: r.brain_customer_id,
          customerName: nameById.get(r.brain_customer_id) ?? '',
          scheduledAt: r.scheduled_at,
          createdAt: r.created_at,
          lastVisitDate: reminderLastVisitByCustomer.get(r.brain_customer_id) ?? null,
          contraindications: contraindications.map((c) => ({
            severity: c.severity, title: c.title, description: c.description,
          })),
          importantMemories: allMemories.filter((m) => m.importance === 'high').map((m) => m.content),
          recentMemories: allMemories.map((m) => m.content),
        }
      })

      visitReminders = buildVisitReminders(reminderInputs)
    }

    // ── 📋 新規予約(§1・§4): 週1CSV取込後の差分をcreated_atで近似 ─────────
    // AUTH-2準拠: 来店リマインドと同じくreservations.staff_idで絞る。
    let newReservationQuery = supabase
      .from('reservations')
      .select('id, brain_customer_id, staff_id, scheduled_at, created_at')
      .not('brain_customer_id', 'is', null)

    if (!staff.isAdmin) {
      newReservationQuery = newReservationQuery.eq('staff_id', staff.authUserId)
    }

    const { data: allStaffReservations, error: newResvError } = await newReservationQuery
    if (newResvError) {
      return NextResponse.json({ success: false, error: newResvError.message }, { status: 500 })
    }

    let newReservationNotifications: StaffNotification[] = []
    if (allStaffReservations && allStaffReservations.length > 0) {
      type AllResvRow = { id: string; brain_customer_id: string; staff_id: string; scheduled_at: string; created_at: string }
      // 社内利用者の予約は新規予約通知の対象外。
      const rows = (allStaffReservations as AllResvRow[]).filter(
        (r) => !internalUserIds.has(r.brain_customer_id)
      )
      const newResvCustomerIds = Array.from(new Set(rows.map((r) => r.brain_customer_id)))
      const { data: newResvCustomers, error: newResvCustErr } = await supabase
        .from('brain_customers')
        .select('id, name')
        .in('id', newResvCustomerIds)
      if (newResvCustErr) {
        return NextResponse.json({ success: false, error: newResvCustErr.message }, { status: 500 })
      }
      const newResvNameById = new Map((newResvCustomers ?? []).map((c) => [c.id, c.name]))

      const newReservationInputs: NewReservationInput[] = rows.map((r) => ({
        reservationId: r.id,
        customerId: r.brain_customer_id,
        customerName: newResvNameById.get(r.brain_customer_id) ?? '',
        scheduledAt: r.scheduled_at,
        createdAt: r.created_at,
      }))
      newReservationNotifications = buildNewReservationNotifications(newReservationInputs)
    }

    // 管理者向け通知(離脱予兆・承認待ち等)はこのAPIでは扱わない。本エンドポイントは
    // スタッフアプリ(Phase1Screen)専用であり、経営分析・管理者向け情報は
    // 管理者アプリ(app/admin/**)側に集約する設計方針のため(PHASE NOTIF_STAFF_ONLY_1)。

    // 通知は最大5件まで(現場で読み切れる件数に絞る・PHASE NOTIF_STAFF_ONLY_1)。
    // 優先順: 本日の来店リマインド → 新規予約 → 祝福/気遣い/事実系。
    const MAX_NOTIFICATIONS = 5
    const allNotifications = [...visitReminders, ...newReservationNotifications, ...notifications]

    return NextResponse.json({
      success: true,
      notifications: allNotifications.slice(0, MAX_NOTIFICATIONS),
      scannedCount: customers.length,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

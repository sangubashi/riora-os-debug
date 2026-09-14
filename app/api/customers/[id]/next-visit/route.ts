/**
 * GET/PATCH /api/customers/[id]/next-visit — 次回目安エンジン(PHASE NEXT-VISIT-1・2026-09-11)
 *
 * GET: brain_customers.next_visit_override_date・直近の未来予約・来店履歴(最大5件)を
 *      取得し、src/lib/nextVisit/nextVisitEngine.ts(ルールベース・LLM不使用)で算出した
 *      結果を返す。next_visit_hidden_from_customer(お客様用カルテ再構成・2026-09-14)も
 *      合わせて返す。
 * PATCH: 担当スタッフによる手動上書き(next_visit_override_date)、および
 *        お客様モードでの非表示設定(next_visit_hidden_from_customer)の更新を扱う
 *        (いずれか一方、または両方を同時に指定できる部分更新)。
 *        hiddenFromCustomerはお客様モード(CustomerModeView.tsx)の表示のみを制御し、
 *        スタッフ向け画面(CustomerBottomSheet/IpadStaffKarteView)には影響しない。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'
import { computeNextVisit, type PaymentType, type NextVisitResult } from '@/lib/nextVisit/nextVisitEngine'

function todayIsoUtc(): string {
  return new Date().toISOString()
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()

  const [customerRes, reservationRes, visitsRes] = await Promise.all([
    supabase
      .from('brain_customers')
      .select('next_visit_override_date, is_subscriber, next_visit_hidden_from_customer')
      .eq('id', customerId)
      .eq('store_id', DEMO_STORE_ID)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('reservations')
      .select('scheduled_at')
      .eq('brain_customer_id', customerId)
      .gt('scheduled_at', todayIsoUtc())
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('brain_visits')
      .select('visit_date, menu_id')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(5),
  ])

  if (customerRes.error) {
    return NextResponse.json({ success: false, error: customerRes.error.message }, { status: 500 })
  }
  if (!customerRes.data) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  const visits = visitsRes.data ?? []
  const latestMenuId = visits[0]?.menu_id ?? null

  let currentMenuName: string | null = null
  if (latestMenuId) {
    const { data: menu } = await supabase.from('brain_menus').select('name').eq('id', latestMenuId).maybeSingle()
    currentMenuName = menu?.name ?? null
  }

  const overrideDate = (customerRes.data as { next_visit_override_date: string | null }).next_visit_override_date
  const isSubscriber = (customerRes.data as { is_subscriber: boolean | null }).is_subscriber ?? false
  const hiddenFromCustomer = (customerRes.data as { next_visit_hidden_from_customer: boolean | null }).next_visit_hidden_from_customer ?? false
  const nextReservationDate = reservationRes.data?.scheduled_at
    ? String(reservationRes.data.scheduled_at).slice(0, 10)
    : null

  // 支払形態(READ ONLY調査2026-09-11で確認済み): 回数券データはDBのどこにも存在しないため
  // 常にfalse相当。サブスクのみis_subscriberから判定する(brain_subscriptionsは本番0件のため
  // 参照しない)。
  const paymentType: PaymentType = isSubscriber ? 'subscription' : 'per_visit'

  const result: NextVisitResult = computeNextVisit({
    overrideDate,
    nextReservationDate,
    visitDates: visits.map(v => v.visit_date as string),
    currentMenuName,
    paymentType,
  })

  return NextResponse.json({ success: true, result, overrideDate, hiddenFromCustomer })
}

const patchBodySchema = z.object({
  overrideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'overrideDate must be YYYY-MM-DD').nullable().optional(),
  hiddenFromCustomer: z.boolean().optional(),
}).refine(
  (v) => v.overrideDate !== undefined || v.hiddenFromCustomer !== undefined,
  { message: 'overrideDate or hiddenFromCustomer is required' }
)

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = patchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  const updateFields: { next_visit_override_date?: string | null; next_visit_hidden_from_customer?: boolean } = {}
  if (parsed.data.overrideDate !== undefined) updateFields.next_visit_override_date = parsed.data.overrideDate
  if (parsed.data.hiddenFromCustomer !== undefined) updateFields.next_visit_hidden_from_customer = parsed.data.hiddenFromCustomer

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_customers')
    .update(updateFields)
    .eq('id', customerId)
    .eq('store_id', DEMO_STORE_ID)
    .is('deleted_at', null)
    .select('id, next_visit_override_date, next_visit_hidden_from_customer')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  const row = data as { next_visit_override_date: string | null; next_visit_hidden_from_customer: boolean }
  return NextResponse.json({
    success: true,
    overrideDate: row.next_visit_override_date,
    hiddenFromCustomer: row.next_visit_hidden_from_customer,
  })
}

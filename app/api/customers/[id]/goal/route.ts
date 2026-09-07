/**
 * GET/PATCH /api/customers/[id]/goal — 顧客の目標(brain_customers.goal_note)
 *
 * デジタル顧客カルテ Phase1-A。既存列(goal_note)をそのまま利用する
 * (wedding_date等のPhase3用列・primary_delta連携は今回対象外)。
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'

const patchBodySchema = z.object({
  goalNote: z.string().trim().max(1000, 'goalNote is too long').nullable(),
})

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
  const { data, error } = await supabase
    .from('brain_customers')
    .select('goal_note')
    .eq('id', customerId)
    .eq('store_id', DEMO_STORE_ID)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  return NextResponse.json({
    success:  true,
    goalNote: (data as { goal_note: string | null }).goal_note,
  })
}

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

  // 空文字は「未設定」としてNULLに正規化する(goal_note列はNULL許容)。
  const goalNote = parsed.data.goalNote && parsed.data.goalNote.length > 0 ? parsed.data.goalNote : null

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_customers')
    .update({ goal_note: goalNote })
    .eq('id', customerId)
    .eq('store_id', DEMO_STORE_ID)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, goalNote })
}

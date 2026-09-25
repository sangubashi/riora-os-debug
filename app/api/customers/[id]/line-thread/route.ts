/**
 * GET /api/customers/[id]/line-thread — 顧客専用LINE会話履歴
 *
 * カルテアプリ(iPad)の顧客トップページ(CustomerTopPage.tsx)専用API。
 * 既存の lineAdminQueries.ts の getLineThreadMessages() をそのまま再利用するだけで、
 * LINE基盤側(app/api/line/**・src/lib/line/**)は一切変更しない。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 * 担当者制は存在しないため requireAdmin は使用しない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { getLineThreadMessages } from '@/lib/line/lineAdminQueries'

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

  const { data: linkedUser, error: linkError } = await supabase
    .from('line_user_ids')
    .select('line_user_id, display_name')
    .eq('customer_id', customerId)
    .order('followed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (linkError) {
    return NextResponse.json({ success: false, error: linkError.message }, { status: 500 })
  }
  if (!linkedUser) {
    return NextResponse.json({ success: true, linked: false, lineUserId: null, displayName: null, messages: [] })
  }

  try {
    const messages = await getLineThreadMessages(supabase, linkedUser.line_user_id as string)
    return NextResponse.json({
      success: true,
      linked:  true,
      lineUserId:  linkedUser.line_user_id as string,
      displayName: linkedUser.display_name as string | null,
      messages,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

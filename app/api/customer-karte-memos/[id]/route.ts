/**
 * PATCH  /api/customer-karte-memos/[id]
 * DELETE /api/customer-karte-memos/[id]
 *
 * customer_id 所有確認: 操作対象メモが要求元 customer_id に属すること。不一致は403。
 * PATCHは content と updated_at のみを更新するシンプルなUPDATE方式(編集履歴は残さない)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../lib/repos'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

async function verifyOwnership(id: string, customerId: string): Promise<boolean> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('customer_karte_memos')
    .select('customer_id')
    .eq('id', id)
    .single()
  return !!data && data.customer_id === customerId
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqStaff = await extractStaffFromRequest(req)
  if (!reqStaff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { customer_id: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const accessible = await canAccessCustomer(reqStaff.staffBrainId, body.customer_id, reqStaff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id } = await params
  const owned = await verifyOwnership(id, body.customer_id)
  if (!owned) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('customer_karte_memos')
    .update({ content: body.content.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, customer_id, staff_id, content, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ memo: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqStaff = await extractStaffFromRequest(req)
  if (!reqStaff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const customerId = req.nextUrl.searchParams.get('customer_id')
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const accessible = await canAccessCustomer(reqStaff.staffBrainId, customerId, reqStaff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id } = await params
  const owned = await verifyOwnership(id, customerId)
  if (!owned) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('customer_karte_memos')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}

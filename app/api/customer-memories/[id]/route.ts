/**
 * PATCH  /api/customer-memories/[id]
 * DELETE /api/customer-memories/[id]
 *
 * customer_id 所有確認: 操作対象メモリが要求元 customer_id に属すること。
 * 不一致は 403 を返す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../lib/repos'
import type { MemoryType, MemoryImportance } from '@/types/customerMemory'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

async function verifyOwnership(
  id: string,
  customerId: string,
): Promise<boolean> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('customer_memories')
    .select('customer_id')
    .eq('id', id)
    .eq('store_id', STORE_ID)
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

  let body: {
    customer_id:   string
    content?:      string
    memory_type?:  MemoryType
    trigger_date?: string | null
    importance?:   MemoryImportance
    is_sensitive?: boolean
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const { id } = await params
  const owned = await verifyOwnership(id, body.customer_id)
  if (!owned) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { customer_id: _, ...rest } = body
  const updates: Record<string, unknown> = {}
  if (rest.content      !== undefined) updates.content      = rest.content.trim()
  if (rest.memory_type  !== undefined) updates.memory_type  = rest.memory_type
  if (rest.trigger_date !== undefined) updates.trigger_date = rest.trigger_date
  if (rest.importance   !== undefined) updates.importance   = rest.importance
  if (rest.is_sensitive !== undefined) updates.is_sensitive = rest.is_sensitive

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('customer_memories')
    .update(updates)
    .eq('id', id)
    .eq('store_id', STORE_ID)
    .select()
    .single()

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ memory: data })
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

  const { id } = await params
  const owned = await verifyOwnership(id, customerId)
  if (!owned) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('customer_memories')
    .delete()
    .eq('id', id)
    .eq('store_id', STORE_ID)

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}

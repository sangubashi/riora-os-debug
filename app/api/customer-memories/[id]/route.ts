/**
 * PATCH  /api/customer-memories/[id]
 * DELETE /api/customer-memories/[id]
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../lib/repos'
import type { MemoryType, MemoryImportance } from '@/types/customerMemory'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: {
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

  const updates: Record<string, unknown> = {}
  if (body.content      !== undefined) updates.content      = body.content.trim()
  if (body.memory_type  !== undefined) updates.memory_type  = body.memory_type
  if (body.trigger_date !== undefined) updates.trigger_date = body.trigger_date
  if (body.importance   !== undefined) updates.importance   = body.importance
  if (body.is_sensitive !== undefined) updates.is_sensitive = body.is_sensitive

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('customer_memories')
    .update(updates)
    .eq('id', params.id)
    .eq('store_id', STORE_ID)
    .select()
    .single()

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ memory: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('customer_memories')
    .delete()
    .eq('id', params.id)
    .eq('store_id', STORE_ID)

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}

/**
 * GET  /api/customer-memories?customer_id=xxx
 * POST /api/customer-memories
 *
 * service role でRLSをバイパス。
 * このAPIの返すデータは接客支援AI（ProposalOrchestrator/FireScore）へ渡さないこと。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../lib/repos'
import type { MemoryType, MemoryImportance } from '@/types/customerMemory'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get('customer_id')
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('customer_memories')
    .select('*')
    .eq('customer_id', customerId)
    .eq('store_id', STORE_ID)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ memories: data ?? [] })
}

export async function POST(req: NextRequest) {
  let body: {
    customer_id:  string
    content:      string
    memory_type?: MemoryType
    trigger_date?: string | null
    importance?:  MemoryImportance
    is_sensitive?: boolean
    created_by?:  string | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.customer_id || !body.content?.trim()) {
    return NextResponse.json({ error: 'customer_id and content are required' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('customer_memories')
    .insert({
      customer_id:  body.customer_id,
      store_id:     STORE_ID,
      content:      body.content.trim(),
      memory_type:  body.memory_type  ?? 'other',
      trigger_date: body.trigger_date ?? null,
      importance:   body.importance   ?? 'medium',
      is_sensitive: body.is_sensitive ?? false,
      created_by:   body.created_by   ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ memory: data }, { status: 201 })
}

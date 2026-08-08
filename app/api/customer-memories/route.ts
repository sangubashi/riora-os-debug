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
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

// 音声メモ保存時、/api/voice-pipeline(Claude解析経由)とVoiceMemoSection(スタッフ手動選択経由)
// が同じ録音から並行してcustomer_memoriesへ書き込む構造になっているため、この経路(POST)側に
// 軽量な重複チェックを追加する。voice-pipeline側の重複チェック(app/api/voice-pipeline/route.ts
// の content.slice(0,30) 前方一致)と判定基準を揃え、直近数分以内・同一customer_idの範囲に限定
// することで、明確に異なる内容の通常のMemory登録(手動含む)まで誤って潰さないようにする。
const DUPLICATE_CHECK_WINDOW_MS = 5 * 60 * 1000
const DUPLICATE_CHECK_PREFIX_LEN = 30

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const customerId = req.nextUrl.searchParams.get('customer_id')
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
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
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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

  const accessible = await canAccessCustomer(staff.staffBrainId, body.customer_id, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()
  const trimmedContent = body.content.trim()

  // 直近数分以内・同一customer_idの既存レコードと前方一致すればスキップする
  // (音声メモの2経路並行書込みによる重複のみを狙い撃ちし、内容が明確に異なる
  // Memoryや、時間の空いた通常のMemory登録は従来通り保存される)。
  const since = new Date(Date.now() - DUPLICATE_CHECK_WINDOW_MS).toISOString()
  const { data: recent } = await supabase
    .from('customer_memories')
    .select('content')
    .eq('customer_id', body.customer_id)
    .gte('created_at', since)

  const prefix = trimmedContent.slice(0, DUPLICATE_CHECK_PREFIX_LEN)
  const isDuplicate = (recent ?? []).some(
    (m: { content: string }) => m.content.slice(0, DUPLICATE_CHECK_PREFIX_LEN) === prefix
  )

  if (isDuplicate) {
    return NextResponse.json({ skipped: true, reason: 'duplicate_recent_memory' }, { status: 200 })
  }

  const { data, error } = await supabase
    .from('customer_memories')
    .insert({
      customer_id:  body.customer_id,
      store_id:     STORE_ID,
      content:      trimmedContent,
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

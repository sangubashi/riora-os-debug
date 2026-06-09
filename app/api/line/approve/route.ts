/**
 * /api/line/approve
 * LINE 送信キューの承認 API。
 * 承認時は実際に sendLineMessage() で LINE 送信まで行い、
 * 結果に応じて status を 'sent' / 'failed' に更新し line_send_logs に記録する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendLineMessage } from '../../../lib/line/sender'

function getSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
                   ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase env not configured')
  return createClient(supabaseUrl, supabaseKey)
}

async function logSendResult(
  supabase: SupabaseClient,
  queueId: string,
  recipientId: string,
  messageBody: string,
  status: 'success' | 'failed',
  errorMsg?: string,
) {
  const { error } = await supabase.from('line_send_logs').insert({
    mode:         'production',
    recipient_id: recipientId,
    message_body: messageBody,
    status,
    error_msg:    errorMsg ?? null,
    metadata:     { source: 'approval_flow', queue_id: queueId, direction: 'outgoing' },
  })
  if (error) console.error('[Approve] line_send_logs insert error:', error.message)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { id?: string; action?: 'approve' | 'skip' }

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    let supabase: SupabaseClient
    try {
      supabase = getSupabase()
    } catch {
      return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 })
    }

    // ─── skip: ステータス更新のみ ─────────────────────────────────────────
    if (body.action === 'skip') {
      const { error } = await supabase
        .from('line_send_queue')
        .update({ status: 'skipped' })
        .eq('id', body.id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      return NextResponse.json({
        success:   true,
        id:        body.id,
        newStatus: 'skipped',
        updatedAt: new Date().toISOString(),
      })
    }

    // ─── approve: 承認 → 実送信 → 結果反映 ────────────────────────────────
    const { data: item, error: fetchError } = await supabase
      .from('line_send_queue')
      .select('id, line_user_id, message_body')
      .eq('id', body.id)
      .single()

    if (fetchError || !item) {
      return NextResponse.json({ error: fetchError?.message ?? 'queue item not found' }, { status: 404 })
    }

    await supabase
      .from('line_send_queue')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', body.id)

    const result = await sendLineMessage(item.line_user_id, item.message_body)

    if (result.ok) {
      const sentAt = new Date().toISOString()

      const { error: updateError } = await supabase
        .from('line_send_queue')
        .update({ status: 'sent', sent_at: sentAt })
        .eq('id', body.id)

      await logSendResult(supabase, item.id, item.line_user_id, item.message_body, 'success')

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

      return NextResponse.json({
        success:   true,
        id:        body.id,
        newStatus: 'sent',
        updatedAt: sentAt,
      })
    }

    // ─── 送信失敗 ─────────────────────────────────────────────────────────
    const { error: failError } = await supabase
      .from('line_send_queue')
      .update({ status: 'failed', error_message: result.error })
      .eq('id', body.id)

    await logSendResult(supabase, item.id, item.line_user_id, item.message_body, 'failed', result.error)

    if (failError) return NextResponse.json({ error: failError.message }, { status: 500 })

    return NextResponse.json({
      success:   false,
      id:        body.id,
      newStatus: 'failed',
      error:     result.error,
    }, { status: 502 })

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

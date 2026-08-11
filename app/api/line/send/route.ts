/**
 * POST /api/line/send
 * `/line`スタッフ向けチャット画面からの手動1件送信専用API。
 *
 * 調査(2026-08-08)で判明した「ChatWindow.tsxの送信ボタンがLINE Push APIを一切呼ばず
 * line_messagesへのINSERTのみで完結している」問題への対応。/api/line/approve（AI下書き
 * →承認キュー）とは完全に独立したルートで、既存の承認フロー・line_send_queueには一切
 * 触れない。認証・Rate Limit・送信・ログ記録の部品は/api/line/approveと共通のものを
 * そのまま再利用する(新しい送信ロジックは作らない)。
 *
 * customerIdからline_user_idへの解決のみ、このルート固有の処理として追加している
 * (src/lib/line/lineQueueGenerator.ts の getLineUserId() と同一ロジック。LINE領域の
 * 凍結対象ファイルには触れない方針のため、ここでは同じクエリを独立して持つ)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendLineMessage } from '../../../lib/line/sender'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { lineSendDuplicateLimiter } from '@/lib/rateLimit'

function getSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
                   ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase env not configured')
  return createClient(supabaseUrl, supabaseKey)
}

async function logSendResult(
  supabase: SupabaseClient,
  customerId: string,
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
    metadata:     { source: 'chat_direct', customer_id: customerId, direction: 'outgoing' },
  })
  if (error) console.error('[LineSend] line_send_logs insert error:', error.message)
}

interface RequestBody {
  customerId: string
  body:       string
}

export async function POST(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  let parsed: Partial<RequestBody>
  try {
    parsed = await req.json() as Partial<RequestBody>
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  if (typeof parsed.customerId !== 'string' || parsed.customerId.trim().length === 0) {
    return NextResponse.json({ success: false, error: 'customer_id_required' }, { status: 400 })
  }
  if (typeof parsed.body !== 'string' || parsed.body.trim().length === 0) {
    return NextResponse.json({ success: false, error: 'body_required' }, { status: 400 })
  }
  const customerId  = parsed.customerId
  const messageBody = parsed.body.trim()

  // SECURITY: 担当外顧客への送信を防ぐ(既存のcanAccessCustomerルールに従う)。
  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch {
    return NextResponse.json({ success: false, error: 'supabase_env_not_configured' }, { status: 500 })
  }

  // customerId → line_user_id 解決(未フォロー除外)。承認フローはキュー投入時に
  // 既にline_user_idを保持しているため、この解決はチャット直接送信固有の処理。
  const { data: lineUser } = await supabase
    .from('line_user_ids')
    .select('line_user_id')
    .eq('customer_id', customerId)
    .is('unfollowed_at', null)
    .maybeSingle()

  if (!lineUser?.line_user_id) {
    return NextResponse.json({ success: false, error: 'line_user_id_not_found' }, { status: 404 })
  }
  const lineUserId = lineUser.line_user_id as string

  // /api/line/approveと同じ二重送信防止(同一送信先への短時間の重複送信をブロック)
  const rl = await lineSendDuplicateLimiter.limit(lineUserId)
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'duplicate_send_blocked' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) } },
    )
  }

  const result = await sendLineMessage(lineUserId, messageBody)

  if (result.ok) {
    await logSendResult(supabase, customerId, lineUserId, messageBody, 'success')
    return NextResponse.json({ success: true })
  }

  await logSendResult(supabase, customerId, lineUserId, messageBody, 'failed', result.error)
  return NextResponse.json({ success: false, error: result.error }, { status: 502 })
}

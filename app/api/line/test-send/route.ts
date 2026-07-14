/**
 * POST /api/line/test-send
 *
 * テスト専用 LINE 送信エンドポイント。
 * - 送信先は ENV の LINE_TEST_USER_ID に固定（顧客データ不使用）
 * - mode は 'test' でハードコード（本番送信と物理的に分離）
 * - 送信結果を line_send_logs に記録する
 *
 * 必要 ENV:
 *   LINE_CHANNEL_ACCESS_TOKEN  — LINE チャンネルアクセストークン
 *   LINE_TEST_USER_ID          — 送信先（自分のLINE user ID）
 *   SUPABASE_SERVICE_ROLE_KEY  — ログ書き込み用（RLS バイパス）
 *   NEXT_PUBLIC_SUPABASE_URL   — Supabase URL
 */

import { NextRequest, NextResponse }  from 'next/server'
import { createClient }  from '@supabase/supabase-js'
import { sendLineMessage } from '../../../lib/line/sender'
import { requireAdmin } from '@/lib/auth/requireAdmin'

// テスト送信のデフォルトメッセージ
// 将来: リクエストボディの message_body フィールドで AI 生成文を渡せる
const DEFAULT_TEST_MESSAGE = `【Riora OS テスト送信】
${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

これは LINE 半自動送信機能のテストメッセージです。
このメッセージが届いていれば接続成功です。`

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  // ── ENV 検証 ──────────────────────────────────────────────────────────────
  const recipientId = process.env.LINE_TEST_USER_ID
  if (!recipientId) {
    return NextResponse.json(
      { ok: false, error: 'ENV missing: LINE_TEST_USER_ID が設定されていません' },
      { status: 500 },
    )
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { ok: false, error: 'ENV missing: SUPABASE_SERVICE_ROLE_KEY または NEXT_PUBLIC_SUPABASE_URL が未設定' },
      { status: 500 },
    )
  }

  // ── メッセージ本文を決定（リクエストボディで上書き可能） ─────────────────
  let messageBody = DEFAULT_TEST_MESSAGE
  try {
    const body = await req.json().catch(() => null)
    if (body?.message_body && typeof body.message_body === 'string') {
      messageBody = body.message_body
    }
  } catch { /* body なし = デフォルトメッセージ使用 */ }

  // ── LINE 送信 ─────────────────────────────────────────────────────────────
  const result = await sendLineMessage(recipientId, messageBody)

  // ── Supabase ログ保存（service role でRLSバイパス） ───────────────────────
  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: logRow, error: logError } = await supabase
    .from('line_send_logs')
    .insert({
      mode:         'test',
      recipient_id: recipientId,
      message_body: messageBody,
      status:       result.ok ? 'success' : 'failed',
      error_msg:    result.ok ? null : result.error,
      metadata:     {
        direction: 'outgoing',
        endpoint: '/api/line/test-send',
        user_agent: req.headers.get('user-agent') ?? '',
      },
    })
    .select('id, sent_at')
    .single()

  if (logError) {
    console.error('[line/test-send] ログ保存失敗:', logError)
  }

  // ── レスポンス ────────────────────────────────────────────────────────────
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, logId: logRow?.id ?? null },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok:       true,
    message:  'テスト送信成功',
    logId:    logRow?.id ?? null,
    sentAt:   logRow?.sent_at ?? new Date().toISOString(),
  })
}

/**
 * /api/line/webhook
 *
 * LINE Messaging API からのイベントを受信する。
 * 処理するイベント:
 *   follow   → line_user_ids に userId / displayName / followed_at を保存
 *   unfollow → line_user_ids.unfollowed_at を更新
 *   message  → 将来実装（現時点は 200 返すのみ）
 *   read     → 将来実装（現時点は 200 返すのみ）
 *
 * セキュリティ:
 *   X-Line-Signature ヘッダーで HMAC-SHA256 署名を検証する。
 *   検証失敗時は 401 を返す。
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac }                from 'crypto'
import { createClient }              from '@supabase/supabase-js'

// ─── 型定義 ───────────────────────────────────────────────────────────────────

interface LineSource {
  type:   'user' | 'group' | 'room'
  userId?: string
}

interface LineFollowEvent {
  type:      'follow'
  source:    LineSource
  timestamp: number
  replyToken?: string
  webhookEventId?: string
}

interface LineUnfollowEvent {
  type:      'unfollow'
  source:    LineSource
  timestamp: number
  webhookEventId?: string
}

interface LineMessageEvent {
  type:      'message'
  source:    LineSource
  timestamp: number
  replyToken?: string
  message:   { id: string; type: string; text?: string }
  webhookEventId?: string
}

interface LineReadEvent {
  type:    'read'
  source:  LineSource
  timestamp: number
  webhookEventId?: string
}

type LineEvent =
  | LineFollowEvent
  | LineUnfollowEvent
  | LineMessageEvent
  | LineReadEvent
  | { type: string; source: LineSource; timestamp: number; webhookEventId?: string }

interface LineWebhookBody {
  destination: string
  events:      LineEvent[]
}

// ─── 署名検証 ─────────────────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const hash = createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64')
  return hash === signature
}

// ─── LINE Profile 取得 ────────────────────────────────────────────────────────

async function fetchLineProfile(
  userId: string,
  accessToken: string
): Promise<{ displayName: string; pictureUrl?: string } | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { displayName?: string; pictureUrl?: string }
    return {
      displayName: data.displayName ?? '',
      pictureUrl:  data.pictureUrl,
    }
  } catch {
    return null
  }
}

// ─── Supabase クライアント（service_role で RLS バイパス） ────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key)
}

// ─── 受信ログ保存 ────────────────────────────────────────────────────────────

async function logWebhookEvent(
  userId: string,
  eventType: string,
  status: 'success' | 'failed',
  extra: Record<string, unknown> = {}
) {
  try {
    const supabase = getSupabase()
    const { error } = await supabase.from('line_send_logs').insert({
      mode:         'test',
      recipient_id: userId || 'unknown',
      message_body: `[WEBHOOK incoming] ${eventType}`,
      status,
      metadata: { direction: 'incoming', event_type: eventType, ...extra },
    })
    if (error) console.error('[Webhook] log insert error:', error.message)
  } catch (e) {
    console.error('[Webhook] Failed to save log:', e)
  }
}

// ─── 重複イベント検知（簡易版：line_send_logs.metadata.event_id を参照） ──────

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('line_send_logs')
      .select('id')
      .eq('metadata->>event_id', eventId)
      .limit(1)
    if (error) {
      console.error('[Webhook] Duplicate check error:', error.message)
      return false
    }
    return (data?.length ?? 0) > 0
  } catch (e) {
    console.error('[Webhook] Duplicate check failed:', e)
    return false
  }
}

// ─── イベントハンドラー ───────────────────────────────────────────────────────

async function handleFollow(event: LineFollowEvent, accessToken: string) {
  const userId = event.source.userId
  if (!userId) return

  const supabase    = getSupabase()
  const followedAt  = new Date(event.timestamp).toISOString()
  const profile     = await fetchLineProfile(userId, accessToken)

  await supabase
    .from('line_user_ids')
    .upsert(
      {
        line_user_id:  userId,
        display_name:  profile?.displayName ?? '',
        picture_url:   profile?.pictureUrl  ?? null,
        followed_at:   followedAt,
        unfollowed_at: null,   // 再フォロー時にリセット
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'line_user_id' }
    )
}

async function handleUnfollow(event: LineUnfollowEvent) {
  const userId = event.source.userId
  if (!userId) return

  const supabase      = getSupabase()
  const unfollowedAt  = new Date(event.timestamp).toISOString()

  await supabase
    .from('line_user_ids')
    .update({ unfollowed_at: unfollowedAt, updated_at: new Date().toISOString() })
    .eq('line_user_id', userId)
}

// ─── メインハンドラー ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  console.log('[Webhook] Request received')

  const channelSecret  = process.env.LINE_CHANNEL_SECRET
  const accessToken    = process.env.LINE_CHANNEL_ACCESS_TOKEN

  if (!channelSecret || !accessToken) {
    console.error('[Webhook] LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // raw body を取得（署名検証に必要）
  const rawBody  = await req.text()
  const signature = req.headers.get('x-line-signature') ?? ''

  // 署名検証
  if (!verifySignature(rawBody, signature, channelSecret)) {
    console.warn('[Webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: LineWebhookBody
  try {
    body = JSON.parse(rawBody) as LineWebhookBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('[Webhook] events count:', body.events?.length)

  // イベントを順次処理（エラーは個別にキャッチして処理継続）
  for (const event of body.events) {
    const userId  = event.source.userId ?? 'unknown'
    const eventId = event.webhookEventId
    console.log(`[Webhook] event=${event.type} userId=${userId} eventId=${eventId ?? 'none'}`)

    // 重複検知：同じ webhookEventId を処理済みならスキップして次のイベントへ
    if (eventId && await isDuplicateEvent(eventId)) {
      console.log(`[Webhook] 重複イベントをスキップ eventId=${eventId}`)
      continue
    }

    const extra = { destination: body.destination, event_id: eventId ?? null }
    try {
      if (event.type === 'follow') {
        await handleFollow(event as LineFollowEvent, accessToken)
        await logWebhookEvent(userId, 'follow', 'success', extra)
      } else if (event.type === 'unfollow') {
        await handleUnfollow(event as LineUnfollowEvent)
        await logWebhookEvent(userId, 'unfollow', 'success', extra)
      } else {
        // message / read 等は将来実装。受信ログだけ保存する
        await logWebhookEvent(userId, event.type, 'success', extra)
      }
    } catch (e) {
      console.error(`[Webhook] Event error (${event.type}):`, e)
      await logWebhookEvent(userId, event.type, 'failed', { ...extra, error: String(e) })
    }
  }

  // LINE は 200 が返らないとリトライするため必ず 200 を返す
  return NextResponse.json({ status: 'ok' })
}

// LINE Developers の「Webhook URL の検証」ボタン対応
export async function GET() {
  return NextResponse.json({ status: 'LINE Webhook endpoint is active' })
}

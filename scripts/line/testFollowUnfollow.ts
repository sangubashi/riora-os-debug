/**
 * handleFollow() / handleUnfollow() の動作確認スクリプト
 *
 * 実際の userId で follow → unfollow イベントを順に送信し、
 * line_user_ids テーブルへの upsert / update が成功するかを検証する。
 *
 * 実行: npx ts-node scripts/line/testFollowUnfollow.ts
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createHmac } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const WEBHOOK_URL = 'https://riora-os-debug-webhook.vercel.app/api/line/webhook'
const channelSecret = process.env.LINE_CHANNEL_SECRET!
const TARGET_USER_ID = 'U57051505201ca1b7afc8dbc943a17e52'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function buildPayload(type: 'follow' | 'unfollow', suffix: string) {
  return {
    destination: 'test-destination',
    events: [
      {
        type,
        webhookEventId: `test-${type}-${suffix}`,
        timestamp: Date.now(),
        source: { type: 'user', userId: TARGET_USER_ID },
        ...(type === 'follow' ? { replyToken: 'dummy-reply-token' } : {}),
      },
    ],
  }
}

async function send(payload: unknown, label: string) {
  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', channelSecret).update(rawBody).digest('base64')
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
    body: rawBody,
  })
  const json = await res.json().catch(() => null)
  console.log(`[${label}] status=${res.status}`, json)
}

async function dumpRow(label: string) {
  const { data, error } = await supabase
    .from('line_user_ids')
    .select('line_user_id, display_name, picture_url, followed_at, unfollowed_at, updated_at')
    .eq('line_user_id', TARGET_USER_ID)
    .maybeSingle()
  console.log(`[${label}] line_user_ids row:`, error?.message ?? JSON.stringify(data, null, 2))
  return data
}

async function main() {
  const suffix = Date.now().toString()

  console.log('=== 1) follow イベント送信 → handleFollow（upsert）===')
  await send(buildPayload('follow', suffix), 'follow')
  await new Promise(r => setTimeout(r, 1500))
  const afterFollow = await dumpRow('follow後')

  console.log('\n=== 2) unfollow イベント送信 → handleUnfollow（update）===')
  await send(buildPayload('unfollow', suffix), 'unfollow')
  await new Promise(r => setTimeout(r, 1500))
  const afterUnfollow = await dumpRow('unfollow後')

  console.log('\n=== 判定 ===')
  console.log('handleFollow upsert success   :', !!afterFollow && afterFollow.unfollowed_at === null ? 'OK' : 'NG')
  console.log('handleUnfollow update success :', !!afterUnfollow?.unfollowed_at ? 'OK' : 'NG')
}

main()

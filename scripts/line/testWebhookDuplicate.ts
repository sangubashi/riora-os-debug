/**
 * /api/line/webhook の重複防止を検証するスクリプト
 *
 * 同一の webhookEventId を持つイベントを、正しい X-Line-Signature 付きで
 * 2回連続送信する。1回目は通常処理＋ログ保存、2回目はコンソールに
 * 「重複イベントをスキップ」と出て処理がスキップされることを確認できる。
 *
 * 前提: dev server が起動していること（npm run dev）
 * 実行: npx ts-node scripts/line/testWebhookDuplicate.ts
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createHmac } from 'crypto'

const WEBHOOK_URL = process.env.WEBHOOK_TEST_URL ?? 'http://localhost:3000/api/line/webhook'
const channelSecret = process.env.LINE_CHANNEL_SECRET

if (!channelSecret) {
  console.error('Missing ENV: LINE_CHANNEL_SECRET が未設定です')
  process.exit(1)
}

// テスト用ペイロード（follow イベント、webhookEventId は固定値 = 重複扱いになる）
const payload = {
  destination: 'test-destination',
  events: [
    {
      type: 'follow',
      webhookEventId: `test-dedupe-${new Date().toISOString().slice(0, 10)}`,
      timestamp: Date.now(),
      source: { type: 'user', userId: 'Utestuserid0000000000000000000000' },
      replyToken: 'dummy-reply-token',
    },
  ],
}

const rawBody = JSON.stringify(payload)
const signature = createHmac('sha256', channelSecret).update(rawBody).digest('base64')

async function send(label: string) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-line-signature': signature,
    },
    body: rawBody,
  })
  const json = await res.json().catch(() => null)
  console.log(`\n[${label}] status=${res.status}`, json)
}

async function main() {
  console.log('webhookEventId =', payload.events[0].webhookEventId)
  console.log('signature      =', signature)

  await send('1回目（通常処理されるはず）')
  await send('2回目（重複スキップされるはず → サーバーログで確認）')

  console.log('\n→ dev server のコンソールに [Webhook] 重複イベントをスキップ が出ていれば成功です。')
  console.log('→ Supabase line_send_logs を見ると、この event_id のレコードは1件だけのはずです。')
}

main()

/**
 * Phase 2 E2E テスト: line_send_queue → /api/line/approve → LINE送信 → line_send_logs
 *
 * 実行: npx ts-node scripts/line/testApproveFlowE2E.ts
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const APPROVE_URL    = 'http://localhost:3000/api/line/approve'
const TARGET_USER_ID = 'U57051505201ca1b7afc8dbc943a17e52'
const MESSAGE_BODY   = '【Riora OS 承認テスト】\n承認フローの動作確認です。'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  // 1) テストレコード作成
  console.log('=== 1) line_send_queue にテストレコード作成 ===')
  const { data: created, error: insertError } = await supabase
    .from('line_send_queue')
    .insert({
      customer_id:   null,
      customer_name: 'E2Eテスト',
      line_user_id:  TARGET_USER_ID,
      message_body:  MESSAGE_BODY,
      send_mode:     'semi',
      status:        'pending',
      triggered_by:  'e2e_test',
    })
    .select('*')
    .single()

  if (insertError || !created) {
    console.error('insert error:', insertError?.message)
    return
  }
  console.log('作成されたqueueレコード:', JSON.stringify(created, null, 2))

  // 2) ID取得
  const queueId = created.id as string
  console.log('\n=== 2) 取得したID ===')
  console.log('queueId =', queueId)

  // 3) approve API へ POST
  console.log('\n=== 3) POST /api/line/approve ===')
  const res = await fetch(APPROVE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id: queueId, action: 'approve' }),
  })
  const json = await res.json().catch(() => null)

  // 4) レスポンス確認
  console.log('\n=== 4) approve API レスポンス ===')
  console.log('status:', res.status)
  console.log('body  :', JSON.stringify(json, null, 2))

  await new Promise(r => setTimeout(r, 1500))

  // 5) line_send_queue の状態確認
  console.log('\n=== 5) line_send_queue 最終状態 ===')
  const { data: finalQueue, error: queueError } = await supabase
    .from('line_send_queue')
    .select('id, status, approved_at, sent_at, error_message, updated_at')
    .eq('id', queueId)
    .maybeSingle()
  console.log(queueError?.message ?? JSON.stringify(finalQueue, null, 2))

  // 6) line_send_logs 確認
  console.log('\n=== 6) line_send_logs 記録内容 ===')
  const { data: logs, error: logError } = await supabase
    .from('line_send_logs')
    .select('id, mode, recipient_id, message_body, status, error_msg, metadata, sent_at')
    .eq('metadata->>queue_id', queueId)
    .order('sent_at', { ascending: false })
    .limit(5)
  console.log(logError?.message ?? JSON.stringify(logs, null, 2))

  // 7) 判定
  console.log('\n=== 判定 ===')
  const queueOk = finalQueue?.status === 'sent' && !!finalQueue?.sent_at
  const logOk   = !!logs?.some(l =>
    (l.metadata as Record<string, unknown>)?.source === 'approval_flow' && l.status === 'success'
  )
  console.log('line_send_queue: status=sent かつ sent_at あり :', queueOk ? 'OK' : `NG (status=${finalQueue?.status}, error=${finalQueue?.error_message ?? 'なし'})`)
  console.log('line_send_logs : source=approval_flow / status=success :', logOk ? 'OK' : 'NG')
}

main()

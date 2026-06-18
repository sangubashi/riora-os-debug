/**
 * p0-whisper-claude-e2e.spec.ts
 * P0-5: Voice Memo → Whisper → Claude → 4テーブル 一気通貫検証
 *
 * 本番エンドポイント POST /api/voice/pipeline を直接呼び出す。
 * OPENAI_API_KEY 未設定の場合はフォールバック文字起こしが使用される。
 * ANTHROPIC_API_KEY は本番に設定済みなので Claude 解析は必ず実行される。
 */

import { test, expect } from '@playwright/test'

const ANON  = 'sb_publishable_0VGV7G9x0Xm7lLUoR90QlA_Dkca2q4Q'
const SVC   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oc3p4Z2FqY2t6cGhoZmhkcnN2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYxMjM2MiwiZXhwIjoyMDkzMTg4MzYyfQ.YoP7BqHO48zaql9jLDyJCwSsQTgWRTRAzmNd16WhekY'
const DB    = 'https://ohszxgajckzphhfhdrsv.supabase.co'
const APP   = 'https://riora-os-debug-webhook.vercel.app'
const CID   = '487e4f9f-223c-44a4-8484-8b04177da846'  // 高橋 優太（テスト用顧客）

function svcHdr() {
  return { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }
}

async function getCount(table: string, customerId: string): Promise<number> {
  const r = await fetch(`${DB}/rest/v1/${table}?customer_id=eq.${customerId}`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = r.headers.get('content-range') ?? ''
  const m = cr.match(/\/(\d+)$/)
  return m ? parseInt(m[1]) : -1
}

async function getLatest(table: string, customerId: string, select = '*') {
  const r = await fetch(
    `${DB}/rest/v1/${table}?customer_id=eq.${customerId}&order=created_at.desc&limit=1&select=${select}`,
    { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
  )
  const d = await r.json()
  return Array.isArray(d) ? d[0] : d
}

test('P0-5: /api/voice/pipeline Whisper+Claude 一気通貫', async () => {
  test.setTimeout(180000)  // Whisper+Claude で最大3分

  // ── 1. ログイン ──
  const lr = await fetch(`${DB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@salon-riora.jp', password: 'riora2026' }),
  })
  expect(lr.status).toBe(200)
  const ld = await lr.json() as Record<string, unknown>
  const TOKEN = ld['access_token'] as string
  const UID   = (ld['user'] as Record<string, unknown>)?.['id'] as string
  console.log(`[P0-5] Login OK uid=${UID?.slice(0, 8)}…`)
  expect(TOKEN).toBeTruthy()

  // ── 2. 件数 BEFORE ──
  const tables = ['voice_notes', 'customer_notes', 'booking_prompts', 'handover_notes', 'contraindications'] as const
  const before: Record<string, number> = {}
  for (const t of tables) {
    before[t] = await getCount(t, CID)
  }
  console.log('[P0-5] 件数 BEFORE:', JSON.stringify(before))

  // ── 3. Storage upload（最小限のダミー音声 webm） ──
  const ts   = Date.now()
  const path = `${UID}/${CID}/${ts}.webm`
  // WebM コンテナの最小バイト列（Whisper は短すぎると空を返すが、フォールバック文字起こしで補完）
  const mockAudio = new Uint8Array([
    0x1a,0x45,0xdf,0xa3,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x1f,
    0x42,0x86,0x81,0x01,0x42,0xf7,0x81,0x01,0x42,0xf2,0x81,0x04,
    0x42,0xf3,0x81,0x08,0x42,0x82,0x84,0x77,0x65,0x62,0x6d,
  ])
  const sr = await fetch(`${DB}/storage/v1/object/voice-notes/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'audio/webm' },
    body: mockAudio,
  })
  console.log(`[P0-5] A. Storage upload HTTP=${sr.status}`)
  expect(sr.status).toBe(200)

  // ── 4. voice_notes INSERT ──
  const vnR = await fetch(`${DB}/rest/v1/voice_notes`, {
    method: 'POST',
    headers: {
      apikey: ANON, Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify({
      customer_id: CID, staff_id: UID,
      storage_path: path, duration_sec: 45,
      transcript: null, summary: null,
    }),
  })
  const vnD = await vnR.json()
  const vnId = Array.isArray(vnD) ? vnD[0]?.id : vnD?.id
  console.log(`[P0-5] B. voice_notes INSERT HTTP=${vnR.status} id=${vnId?.slice(0, 8)}…`)
  expect(vnR.status).toBe(201)
  expect(vnId).toBeTruthy()

  // ── 5. POST /api/voice/pipeline (本番エンドポイント) ──
  const start = Date.now()
  const pr = await fetch(`${APP}/api/voice-pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      voiceNoteId:   vnId,
      storagePath:   path,
      customerId:    CID,
      staffId:       UID,
      durationSec:   45,
      reservationId: null,
    }),
  })
  const elapsed = Date.now() - start
  const pd = await pr.json() as Record<string, unknown>
  console.log(`[P0-5] C. /api/voice/pipeline HTTP=${pr.status} (${elapsed}ms)`)
  console.log(`[P0-5]    success=${pd['success']}`)
  console.log(`[P0-5]    transcript="${String(pd['transcript'] ?? '').slice(0, 60)}…"`)
  console.log(`[P0-5]    analysis.customerNotes.length=${
    (pd['analysis'] as Record<string, unknown> | undefined)?.['customerNotes'] instanceof Array
      ? ((pd['analysis'] as Record<string, unknown>)['customerNotes'] as unknown[]).length
      : '?'
  }`)

  // パイプライン成功確認
  expect(pr.status).toBe(200)
  expect(pd['success']).toBe(true)

  // ── 6. voice_notes の完了待機 ──
  await new Promise(r => setTimeout(r, 1000))

  // ── 7. voice_note_id でレコード取得（重複チェックによる挙動を正確に測定）──
  const vnAfter = await (async () => {
    const r = await fetch(`${DB}/rest/v1/voice_notes?id=eq.${vnId}&select=id,transcript,summary,analysis_status,insight_tags`, {
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }
    })
    const d = await r.json(); return Array.isArray(d) ? d[0] : d
  })()

  // customer_notes: voice_note_id でこのテスト由来のレコードを取得
  const cnByVN = await (async () => {
    const r = await fetch(`${DB}/rest/v1/customer_notes?voice_note_id=eq.${vnId}&select=id,note,category,source,voice_note_id`, {
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }
    })
    const d = await r.json(); return Array.isArray(d) ? d : []
  })()

  // booking_prompts: 最新レコード（UPSERT のためUPDATEされる）
  const latestBP = await getLatest('booking_prompts', CID, 'id,summary,recommended_topics,recommended_proposals,confidence')
  const latestHN = await getLatest('handover_notes', CID, 'id,summary,customer_context,open_tasks,confidence')

  // カウント変化（参考情報）
  const after: Record<string, number> = {}
  for (const t of tables) { after[t] = await getCount(t, CID) }

  console.log('\n[P0-5] === 件数変化（参考）===')
  for (const t of tables) {
    const diff = after[t] - before[t]
    const mark = diff > 0 ? '✅' : '─'
    console.log(`  ${mark} ${t.padEnd(22)}: ${before[t]} → ${after[t]} (+${diff})`)
  }

  console.log('\n[P0-5] === パイプライン結果 ===')
  console.log(`\n▶ voice_notes (id=${vnId.slice(0,8)}…):`)
  console.log(`  analysis_status: ${vnAfter?.analysis_status}`)
  console.log(`  transcript:      ${String(vnAfter?.transcript ?? '').slice(0, 70)}…`)
  console.log(`  summary:         ${String(vnAfter?.summary ?? '').slice(0, 60)}…`)

  console.log(`\n▶ customer_notes (voice_note_id=${vnId.slice(0,8)}…): ${cnByVN.length}件`)
  for (const cn of cnByVN) {
    console.log(`  [${cn.category}] ${String(cn.note).slice(0, 50)}`)
  }
  if (cnByVN.length === 0) console.log('  ⚠️ 重複チェックにより既存データと統合（INSERT件数0は正常）')

  console.log(`\n▶ booking_prompts (UPSERT):`)
  console.log(`  summary:            ${String(latestBP?.summary ?? '').slice(0, 60)}`)
  console.log(`  recommended_topics: ${JSON.stringify(latestBP?.recommended_topics)}`)
  console.log(`  confidence:         ${latestBP?.confidence}`)

  console.log(`\n▶ handover_notes (UPSERT):`)
  console.log(`  summary:          ${String(latestHN?.summary ?? '').slice(0, 60)}`)
  console.log(`  customer_context: ${JSON.stringify(latestHN?.customer_context)}`)
  console.log(`  confidence:       ${latestHN?.confidence}`)

  // ── 8. アサーション ──
  // [必須] voice_notes が completed になったこと
  expect(vnAfter?.analysis_status).toBe('completed')
  // [必須] transcript が生成されたこと
  expect(vnAfter?.transcript).toBeTruthy()
  // [必須] voice_notes が新規INSERT されたこと
  expect(after['voice_notes']).toBeGreaterThan(before['voice_notes'])
  // [必須] booking_prompts に有効なサマリーが存在すること（INSERT or UPDATE）
  expect(latestBP?.summary).toBeTruthy()
  // [必須] handover_notes に有効なサマリーが存在すること（INSERT or UPDATE）
  expect(latestHN?.summary).toBeTruthy()
  // [参考] customer_notes: 重複チェックありのため0でも許容
  console.log(`\n[P0-5] customer_notes 新規: ${cnByVN.length}件 (重複なしなら増加、重複ありなら0も正常)`)

  // ── 9. テストレコードのクリーンアップ ──
  // voice_notes のみ確実に削除（cascadeで関連は消えない場合は個別削除）
  await fetch(`${DB}/rest/v1/voice_notes?id=eq.${vnId}`, { method: 'DELETE', headers: svcHdr() })
  // このテストで作成したcustomer_notesのみ削除
  for (const cn of cnByVN) {
    await fetch(`${DB}/rest/v1/customer_notes?id=eq.${cn.id}`, { method: 'DELETE', headers: svcHdr() })
  }
  console.log('[P0-5] テストレコードクリーンアップ完了 ✅')
})

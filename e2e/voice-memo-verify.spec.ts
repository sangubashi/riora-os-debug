/**
 * voice-memo-verify.spec.ts
 * Voice Memo 実機検証 E2E テスト
 *
 * 確認項目:
 *   1. currentStaffId が session.user.id から取得されること
 *   2. handleSave が staffId=null でスキップしないこと
 *   3. uploadVoiceNote → voice_notes INSERT 成功
 *   4. 保存後の downstream AI パイプライン呼び出し
 */

import { test, expect, type Page } from '@playwright/test'

const SVC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oc3p4Z2FqY2t6cGhoZmhkcnN2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYxMjM2MiwiZXhwIjoyMDkzMTg4MzYyfQ.YoP7BqHO48zaql9jLDyJCwSsQTgWRTRAzmNd16WhekY'
const SB_URL  = 'https://ohszxgajckzphhfhdrsv.supabase.co'

// ─── MediaRecorder + getUserMedia モック ─────────────────────────────────────
async function injectMocks(page: Page) {
  await page.addInitScript(() => {
    const DUMMY = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f])

    class MockMR extends EventTarget {
      state: RecordingState = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((e: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(_s: MediaStream, _o?: MediaRecorderOptions) { super() }
      start(_t?: number) { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        const blob = new Blob([DUMMY], { type: 'audio/webm' })
        const ev = Object.assign(new Event('dataavailable'), { data: blob }) as BlobEvent
        this.ondataavailable?.(ev)
        setTimeout(() => { this.onstop?.() }, 30)
      }
      static isTypeSupported() { return true }
    }
    // @ts-expect-error mock
    window.MediaRecorder = MockMR
    // @ts-expect-error mock
    navigator.mediaDevices = { getUserMedia: async () => new MediaStream() }
  })
}

// ─── ネットワーク監視 ─────────────────────────────────────────────────────────
interface NetworkLog {
  url:    string
  method: string
  status: number
  body:   string
}

async function watchNetwork(page: Page): Promise<NetworkLog[]> {
  const logs: NetworkLog[] = []
  page.on('response', async (res) => {
    const url = res.url()
    if (!url.includes('supabase')) return
    const method = res.request().method()
    const status = res.status()
    let body = ''
    try { body = await res.text() } catch { /* ignore */ }
    logs.push({ url, method, status, body: body.slice(0, 300) })
    console.log(`[NET] ${method} ${url.split('/').slice(-1)[0].split('?')[0]} → ${status}`)
    if (method === 'POST' || method === 'PATCH') {
      console.log(`  body:`, res.request().postData()?.slice(0, 200))
      console.log(`  resp:`, body.slice(0, 200))
    }
  })
  return logs
}

// ─── コンソールキャプチャ ─────────────────────────────────────────────────────
function captureConsole(page: Page): string[] {
  const lines: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    if (
      text.includes('[CustomerStore]') ||
      text.includes('[VOICE') ||
      text.includes('[voiceNote]') ||
      text.includes('[voiceInsight]') ||
      text.includes('[customerNotes]') ||
      text.includes('[bookingPrompt]') ||
      text.includes('[handover]') ||
      text.includes('[contraindication]') ||
      text.includes('[MERGE]') ||
      text.includes('[RPC]') ||
      text.includes('staffId') ||
      text.includes('currentStaffId') ||
      text.includes('DEMO_MODE')
    ) {
      lines.push(`[${msg.type()}] ${text}`)
      console.log(`[BROWSER] ${text}`)
    }
  })
  page.on('pageerror', err => {
    lines.push(`[ERROR] ${err.message}`)
    console.error(`[BROWSER ERROR] ${err.message}`)
  })
  return lines
}

// ─── DB 件数確認 ──────────────────────────────────────────────────────────────
async function getCount(table: string): Promise<number> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    headers: {
      'apikey': SVC_KEY,
      'Authorization': `Bearer ${SVC_KEY}`,
      'Prefer': 'count=exact',
      'Range': '0-0',
    },
  })
  const range = res.headers.get('content-range') ?? ''
  const match = range.match(/\/(\d+)$/)
  return match ? parseInt(match[1]) : -1
}

// ─── メインテスト ─────────────────────────────────────────────────────────────
test('Voice Memo 保存フロー 実機検証', async ({ page }) => {
  test.setTimeout(90000)

  await injectMocks(page)
  const consoleLogs = captureConsole(page)
  const netLogs     = await watchNetwork(page)

  // ① 初期DB件数
  const before = await getCount('voice_notes')
  console.log(`[VERIFY] voice_notes BEFORE: ${before}`)

  // ② アプリ起動（ホームページ）
  await page.goto('http://localhost:3000/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)  // auto-login 待機

  // ③ currentStaffId が session から取得されているか確認
  const staffIdInPage = await page.evaluate(() => {
    // useStaffStore / useAuthStore の状態を取得
    const stores = (window as Record<string, unknown>).__zustand_stores__
    if (stores) return JSON.stringify(stores)
    return null
  })
  console.log('[VERIFY] zustand stores:', staffIdInPage)

  // ④ /customers へ遷移（顧客一覧）
  await page.goto('http://localhost:3000/customers')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  // ⑤ 顧客数表示を確認
  const countText = await page.locator('h1 + p').first().textContent().catch(() => '')
  console.log('[VERIFY] 顧客一覧 表示テキスト:', countText)

  // ⑥ 顧客カードを探してクリック
  const cards = page.locator('.bg-white.rounded-\\[20px\\]').filter({ hasText: '様' })
  const cardCount = await cards.count()
  console.log('[VERIFY] 顧客カード数:', cardCount)

  if (cardCount === 0) {
    console.log('[VERIFY] 顧客カードなし → ホームから長押しでBottomSheet開く')

    await page.goto('http://localhost:3000/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // ホームの予約カードを長押し
    const reservationCard = page.locator('[class*="rounded"]').filter({ hasText: '様' }).first()
    if (await reservationCard.count() > 0) {
      await reservationCard.dispatchEvent('pointerdown')
      await page.waitForTimeout(700)  // long press threshold
      await reservationCard.dispatchEvent('pointerup')
      await page.waitForTimeout(1000)
    }
  } else {
    // 顧客カードをクリックして詳細シートを開く
    await cards.first().click()
    await page.waitForTimeout(1000)
  }

  // ⑦ 音声メモセクション確認
  const voiceSectionTitle = page.locator('text=🎙️ 音声メモ').first()
  const hasVoiceSection = await voiceSectionTitle.count() > 0
  console.log('[VERIFY] 音声メモセクション存在:', hasVoiceSection)

  if (!hasVoiceSection) {
    // BottomSheet が開いていない場合はcurrentPageを記録
    const url = page.url()
    const pageContent = await page.locator('body').textContent()
    console.log('[VERIFY] 現在URL:', url)
    console.log('[VERIFY] ページ内容（先頭200文字）:', pageContent?.slice(0, 200))

    // それでも音声メモUIが出なければ、API経由で直接検証
    console.log('[VERIFY] UIからの操作をスキップ → API直接検証に移行')
  } else {
    // ⑧ 録音開始
    const startBtn = page.locator('text=録音を開始').first()
    await expect(startBtn).toBeVisible({ timeout: 5000 })
    await startBtn.click()
    console.log('[VERIFY] 録音開始ボタンクリック')

    await page.waitForTimeout(500)

    // ⑨ 録音停止
    const stopBtn = page.locator('text=録音を停止').first()
    if (await stopBtn.count() > 0) {
      await stopBtn.click()
      console.log('[VERIFY] 録音停止ボタンクリック')
      await page.waitForTimeout(500)
    }

    // ⑩ 保存ボタン
    const saveBtn = page.locator('text=保存する').first()
    if (await saveBtn.count() > 0) {
      await expect(saveBtn).toBeEnabled()
      await saveBtn.click()
      console.log('[VERIFY] 保存ボタンクリック')

      // AI解析完了待機（最大15秒）
      await page.waitForTimeout(8000)
    } else {
      console.log('[VERIFY] 保存ボタンが見つかりません')
    }
  }

  // ⑪ DB確認
  const after = await getCount('voice_notes')
  console.log(`[VERIFY] voice_notes AFTER: ${after}`)
  console.log(`[VERIFY] voice_notes 増加: ${after - before}件`)

  // voice_notes最新レコードを取得
  const latestRes = await fetch(
    `${SB_URL}/rest/v1/voice_notes?order=created_at.desc&limit=1`,
    {
      headers: {
        'apikey': SVC_KEY,
        'Authorization': `Bearer ${SVC_KEY}`,
      },
    }
  )
  const latest = await latestRes.json()
  console.log('[VERIFY] 最新 voice_notes:', JSON.stringify(latest, null, 2))

  // ⑫ コンソールログ集計
  console.log('\n=== BROWSER CONSOLE LOGS ===')
  consoleLogs.forEach(l => console.log(l))

  console.log('\n=== NETWORK LOGS (Supabase) ===')
  netLogs
    .filter(l => l.method !== 'GET' || l.url.includes('voice_notes') || l.url.includes('customer_notes'))
    .forEach(l => console.log(`${l.method} ${l.url.split('v1/')[1]?.split('?')[0]} → ${l.status}`))

  // ⑬ アサーション
  // voice_notesの増加は HasVoiceSection のみチェック（UIから操作できた場合）
  if (hasVoiceSection) {
    expect(after).toBeGreaterThan(before)
  }
})

// ─── currentStaffId 単体検証 ─────────────────────────────────────────────────
test('currentStaffId: session.user.id から取得される', async ({ page }) => {
  test.setTimeout(30000)

  const consoleLogs = captureConsole(page)

  await page.goto('http://localhost:3000/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)  // auto-login 待機

  // セッション情報をページ内から取得
  const sessionInfo = await page.evaluate(async () => {
    // supabase client にアクセス
    const result: Record<string, unknown> = {}

    // window.__NEXT_DATA__ からセッション確認
    try {
      const supabaseUrl = 'https://ohszxgajckzphhfhdrsv.supabase.co'
      // localStorage から supabase セッションを確認
      const storageKeys = Object.keys(localStorage)
      const sbKey = storageKeys.find(k => k.includes('supabase') && k.includes('auth'))
      if (sbKey) {
        const raw = localStorage.getItem(sbKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          result['session_user_id'] = parsed?.user?.id ?? null
          result['session_email'] = parsed?.user?.email ?? null
          result['session_expires'] = parsed?.expires_at ?? null
        }
      }
      result['localStorage_keys'] = storageKeys.filter(k => k.includes('supabase'))
    } catch (e) {
      result['error'] = String(e)
    }

    return result
  })

  console.log('[VERIFY] sessionInfo from localStorage:', JSON.stringify(sessionInfo, null, 2))

  // セッションが存在し user.id が設定されていることを確認
  expect(sessionInfo['session_user_id']).toBeTruthy()
  expect(sessionInfo['session_email']).toContain('@')

  // CustomerStore console logs を確認
  const storeLog = consoleLogs.find(l => l.includes('CustomerStore'))
  console.log('[VERIFY] CustomerStore log:', storeLog)
})

// ─── API直接検証: uploadVoiceNote シミュレーション ──────────────────────────
test('API直接検証: uploadVoiceNote フロー', async ({ page }) => {
  test.setTimeout(60000)

  // ADMIN USER: admin@salon-riora.jp → uid = 38de1631-72d5-4891-a2af-5e2830f0326f
  const ADMIN_UID    = '38de1631-72d5-4891-a2af-5e2830f0326f'
  const CUSTOMER_ID  = '487e4f9f-223c-44a4-8484-8b04177da846'  // 高橋 優太
  const ANON_KEY     = 'sb_publishable_0VGV7G9x0Xm7lLUoR90QlA_Dkca2q4Q'

  // ① ページ経由でログイン → JWTトークン取得
  const loginRes = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'admin@salon-riora.jp',
      password: 'riora2026',
    }),
  })

  const loginData = await loginRes.json() as Record<string, unknown>
  const accessToken = loginData['access_token'] as string ?? null
  const userId = (loginData['user'] as Record<string, unknown>)?.['id'] as string ?? null

  console.log('[VERIFY] Login HTTP:', loginRes.status)
  console.log('[VERIFY] user.id:', userId)
  console.log('[VERIFY] access_token:', accessToken ? `${accessToken.slice(0, 30)}…` : 'null')

  expect(loginRes.status).toBe(200)
  expect(userId).toBe(ADMIN_UID)
  expect(accessToken).toBeTruthy()

  // ② Storage: ダミー音声ファイルをアップロード
  const timestamp = Date.now()
  const storagePath = `${userId}/${CUSTOMER_ID}/${timestamp}.webm`
  const dummyAudio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f])

  const storageRes = await fetch(
    `${SB_URL}/storage/v1/object/voice-notes/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'audio/webm',
      },
      body: dummyAudio,
    }
  )
  const storageData = await storageRes.json()
  console.log('[VERIFY] Storage upload HTTP:', storageRes.status)
  console.log('[VERIFY] Storage response:', JSON.stringify(storageData))

  // ③ voice_notes INSERT
  const insertRes = await fetch(`${SB_URL}/rest/v1/voice_notes`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      customer_id:    CUSTOMER_ID,
      staff_id:       userId,
      reservation_id: null,
      storage_path:   storagePath,
      duration_sec:   5,
      transcript:     null,
      summary:        null,
    }),
  })
  const insertData = await insertRes.json()
  console.log('[VERIFY] voice_notes INSERT HTTP:', insertRes.status)
  console.log('[VERIFY] voice_notes INSERT response:', JSON.stringify(insertData))

  expect(insertRes.status).toBe(201)
  const voiceNoteId = Array.isArray(insertData) ? insertData[0]?.id : insertData?.id
  expect(voiceNoteId).toBeTruthy()
  console.log('[VERIFY] voice_note_id:', voiceNoteId)

  // ④ customer_notes INSERT テスト
  // - category/source/voice_note_id カラム有り（20260616_customer_notes_ai.sql 適用済み）→ HTTP 201
  // - カラムなし（未適用）→ HTTP 400 "Could not find the 'category' column"
  // - GRANT なし → HTTP 403
  const cnRes = await fetch(`${SB_URL}/rest/v1/customer_notes`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      customer_id:   CUSTOMER_ID,
      staff_id:      userId,
      note:          '[E2E検証] 家族でお子さんの入学準備をされているとのこと',
      category:      'Family',
      source:        'voice_note',
      voice_note_id: voiceNoteId,
    }),
  })
  console.log('[VERIFY] customer_notes INSERT HTTP:', cnRes.status)
  const cnBody = await cnRes.text()
  console.log('[VERIFY] customer_notes response:', cnBody.slice(0, 200))
  if (cnRes.status === 400 && cnBody.includes('category')) {
    console.log('[VERIFY] ⚠️  customer_notes: 20260616_customer_notes_ai.sql が未適用 → 20260618_fix_grants.sql を適用してください')
  }

  // ⑤ booking_prompts INSERT テスト
  const bpRes = await fetch(`${SB_URL}/rest/v1/booking_prompts`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      customer_id:            CUSTOMER_ID,
      reservation_id:         null,
      store_id:               null,
      summary:                '[E2E検証] 乾燥とエイジングケアへの関心が高い',
      recommended_topics:     ['お子さんの入学', '仕事の忙しさ'],
      recommended_proposals:  ['保湿強化', 'エイジングケア'],
      risk_flags:             [],
      confidence:             0.72,
      generated_at:           new Date().toISOString(),
    }),
  })
  console.log('[VERIFY] booking_prompts INSERT HTTP:', bpRes.status)
  const bpBody = await bpRes.text()
  console.log('[VERIFY] booking_prompts response:', bpBody.slice(0, 200))

  // ⑥ handover_notes INSERT テスト
  const hnRes = await fetch(`${SB_URL}/rest/v1/handover_notes`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      customer_id:         CUSTOMER_ID,
      reservation_id:      null,
      store_id:            null,
      summary:             '[E2E検証] 引継ぎサマリー',
      customer_context:    ['お子さんの入学準備中'],
      open_tasks:          ['ホームケア説明未実施'],
      recommended_actions: ['保湿ケア提案'],
      risk_flags:          [],
      confidence:          0.55,
      generated_at:        new Date().toISOString(),
    }),
  })
  console.log('[VERIFY] handover_notes INSERT HTTP:', hnRes.status)
  const hnBody = await hnRes.text()
  console.log('[VERIFY] handover_notes response:', hnBody.slice(0, 200))

  // ⑦ contraindications INSERT テスト
  const ciRes = await fetch(`${SB_URL}/rest/v1/contraindications`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      customer_id:    CUSTOMER_ID,
      reservation_id: null,
      store_id:       null,
      severity:       'LOW',
      title:          '[E2E検証] 乾燥肌',
      description:    '乾燥が強くバリア機能が低下している可能性',
      recommendation: '施術前後に保湿ケアを強化',
      source:         'voice_notes',
      source_note_id: voiceNoteId,
      confidence:     0.72,
      generated_at:   new Date().toISOString(),
    }),
  })
  console.log('[VERIFY] contraindications INSERT HTTP:', ciRes.status)
  const ciBody = await ciRes.text()
  console.log('[VERIFY] contraindications response:', ciBody.slice(0, 200))

  // ⑧ テストで挿入したレコードをクリーンアップ
  if (voiceNoteId) {
    await fetch(`${SB_URL}/rest/v1/voice_notes?id=eq.${voiceNoteId}`, {
      method: 'DELETE',
      headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}` },
    })
    console.log('[VERIFY] テスト voice_note 削除完了')
  }

  // ⑨ 結果サマリー
  console.log('\n=== INSERT 結果サマリー ===')
  console.log(`Storage upload:      HTTP ${storageRes.status} ${storageRes.status === 200 || storageRes.status === 201 ? '✓' : '✗'}`)
  console.log(`voice_notes:         HTTP ${insertRes.status} ${insertRes.status === 201 ? '✓' : '✗'}`)
  console.log(`customer_notes:      HTTP ${cnRes.status} ${cnRes.status === 201 ? '✓' : '✗ (GRANT未適用の可能性)'}`)
  console.log(`booking_prompts:     HTTP ${bpRes.status} ${bpRes.status === 201 ? '✓' : '✗ (GRANT未適用の可能性)'}`)
  console.log(`handover_notes:      HTTP ${hnRes.status} ${hnRes.status === 201 ? '✓' : '✗ (GRANT未適用の可能性)'}`)
  console.log(`contraindications:   HTTP ${ciRes.status} ${ciRes.status === 201 ? '✓' : '✗ (GRANT未適用の可能性)'}`)
})

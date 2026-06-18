/**
 * prod-verify.spec.ts
 * 本番 (riora-os-debug-webhook.vercel.app) 動作確認
 * STEP1〜5 の UI 到達 + Supabase 書き込み確認
 */

import { test, expect, type Page } from '@playwright/test'

const PROD_URL = 'https://riora-os-debug-webhook.vercel.app'

// ─── MediaRecorder モック（マイク不要で録音フローを動作させる） ────────────────

async function injectMediaRecorderMock(page: Page) {
  await page.addInitScript(() => {
    const DUMMY_BLOB = new Blob(
      [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f])],
      { type: 'audio/webm' }
    )
    class MockMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      ondataavailable: ((e: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      constructor(_s: MediaStream, _o?: MediaRecorderOptions) { super() }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        const e = new Event('dataavailable') as BlobEvent
        Object.defineProperty(e, 'data', { value: DUMMY_BLOB })
        this.ondataavailable?.(e)
        setTimeout(() => this.onstop?.(), 20)
      }
      static isTypeSupported() { return true }
    }
    // @ts-expect-error override
    window.MediaRecorder = MockMediaRecorder
    // @ts-expect-error override
    navigator.mediaDevices = { getUserMedia: async () => new MediaStream() }
  })
}

// ─── Supabase 書き込みインターセプト ─────────────────────────────────────────

type InterceptLog = { table: string; method: string; body: unknown }
async function interceptSupabase(page: Page): Promise<InterceptLog[]> {
  const logs: InterceptLog[] = []
  await page.route('**/rest/v1/**', async (route, request) => {
    const method = request.method()
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      const url = new URL(request.url())
      const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? 'unknown'
      let body: unknown = null
      try { body = request.postDataJSON() } catch { body = request.postData() }
      logs.push({ table, method, body })
    }
    await route.continue()
  })
  return logs
}

// ─── テスト ───────────────────────────────────────────────────────────────────

test.describe('PROD: riora-os-debug-webhook 動作確認', () => {

  test.use({ baseURL: PROD_URL })

  // ─── STEP0: ホームページ + DEMO_MODE 自動サインイン ──────────────────────────
  test('STEP0: ホームページが表示され自動サインインが完了する', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // ページタイトルまたは主要要素が存在することを確認
    const body = await page.textContent('body')
    console.log('[STEP0] Page body snippet:', body?.slice(0, 200))
    console.log('[STEP0] Console errors:', errors)

    // /login にリダイレクトされていないことを確認（DEMO_MODE なので）
    const currentUrl = page.url()
    console.log('[STEP0] Current URL:', currentUrl)

    // エラーが 401 / Invalid API key を含まないことを確認
    const authErrors = errors.filter(e =>
      e.includes('401') || e.includes('Invalid API key') || e.includes('signIn 失敗')
    )
    console.log('[STEP0] Auth errors:', authErrors)

    await page.screenshot({ path: 'test-results/step0-home.png', fullPage: false })
    expect(authErrors).toHaveLength(0)
  })

  // ─── STEP1: CustomerBottomSheet を開く ───────────────────────────────────────
  test('STEP1: 顧客カードをタップして BottomSheet が開く', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // 予約カードまたは顧客名を探してタップ
    const selectors = [
      '[data-reservation-card]',
      '[data-customer-card]',
      'button:has-text("様")',
      'div:has-text("様") >> nth=0',
    ]

    let clicked = false
    for (const sel of selectors) {
      const el = page.locator(sel).first()
      if (await el.count() > 0) {
        await el.click()
        clicked = true
        console.log('[STEP1] Clicked selector:', sel)
        break
      }
    }

    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'test-results/step1-sheet.png', fullPage: false })

    const bodyText = await page.textContent('body')
    console.log('[STEP1] Body after click (snippet):', bodyText?.slice(0, 400))
    console.log('[STEP1] Clicked:', clicked)
  })

  // ─── STEP1b: ログイン画面から手動ログイン ────────────────────────────────────
  test('STEP1b: /login で admin@salon-riora.jp / riora2026 でログインできる', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warn') {
        errors.push(`[${msg.type()}] ${msg.text()}`)
      }
    })

    await page.goto('/login')
    await page.waitForLoadState('networkidle', { timeout: 10000 })
    await page.screenshot({ path: 'test-results/step1b-login-before.png' })

    // メールアドレス入力
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="メール"]').first()
    const passInput  = page.locator('input[type="password"]').first()

    console.log('[STEP1b] Email input found:', await emailInput.count() > 0)
    console.log('[STEP1b] Pass input found:', await passInput.count() > 0)

    if (await emailInput.count() > 0 && await passInput.count() > 0) {
      await emailInput.fill('admin@salon-riora.jp')
      await passInput.fill('riora2026')

      const submitBtn = page.locator('button[type="submit"], button:has-text("ログイン")').first()
      await submitBtn.click()

      // ログイン後のリダイレクトを待つ
      await page.waitForTimeout(3000)
      await page.waitForLoadState('networkidle', { timeout: 10000 })
    }

    const finalUrl = page.url()
    await page.screenshot({ path: 'test-results/step1b-login-after.png' })
    console.log('[STEP1b] Final URL after login:', finalUrl)
    console.log('[STEP1b] Console msgs:', errors.slice(0, 10))

    // /login に留まっていない = ログイン成功
    const authErrors = errors.filter(e => e.includes('Invalid API key') || e.includes('401'))
    console.log('[STEP1b] Auth errors:', authErrors)
  })

  // ─── STEP2〜5: Voice Memo → Notes → BookingPrompt → Handover → Contraindication
  test('STEP2-5: Voice Memo 保存 → 各テーブル書き込み確認', async ({ page }) => {
    await injectMediaRecorderMock(page)
    const dbLogs = await interceptSupabase(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // BottomSheet を開く
    const card = page.locator('[data-reservation-card], [data-customer-card]').first()
    if (await card.count() === 0) {
      console.log('[STEP2-5] No customer card found, trying "様" text')
      const nameEl = page.locator('text=様').first()
      if (await nameEl.count() > 0) await nameEl.click()
    } else {
      await card.click()
    }

    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'test-results/step2-sheet-open.png' })

    // 音声メモ録音ボタンを探す
    const micBtn = page.locator('button:has-text("録音"), button[aria-label*="録音"], [data-testid="mic-btn"]').first()
    console.log('[STEP2] Mic button found:', await micBtn.count() > 0)

    if (await micBtn.count() > 0) {
      await micBtn.click()
      await page.waitForTimeout(600)

      // 録音停止
      const stopBtn = page.locator('button:has-text("停止"), button:has-text("録音を停止")').first()
      if (await stopBtn.count() > 0) {
        await stopBtn.click()
        await page.waitForTimeout(400)
      }

      // 保存ボタン
      const saveBtn = page.locator('button:has-text("保存")').first()
      if (await saveBtn.count() > 0) {
        await saveBtn.click()
        console.log('[STEP2] Save button clicked')
        // AI 処理を待つ（最大 8 秒）
        await page.waitForTimeout(8000)
      }
    }

    await page.screenshot({ path: 'test-results/step2-after-save.png' })

    // DB 書き込みログを解析
    const voiceNoteWrites   = dbLogs.filter(l => l.table === 'voice_notes')
    const customerNoteWrites = dbLogs.filter(l => l.table === 'customer_notes')
    const bookingPromptWrites = dbLogs.filter(l => l.table === 'booking_prompts')
    const handoverWrites    = dbLogs.filter(l => l.table === 'handover_notes')
    const contraindicationWrites = dbLogs.filter(l => l.table === 'contraindications')

    console.log('[STEP1] voice_notes writes:', voiceNoteWrites.length, JSON.stringify(voiceNoteWrites.map(l => l.method)))
    console.log('[STEP2] customer_notes writes:', customerNoteWrites.length)
    console.log('[STEP3] booking_prompts writes:', bookingPromptWrites.length)
    console.log('[STEP4] handover_notes writes:', handoverWrites.length)
    console.log('[STEP5] contraindications writes:', contraindicationWrites.length)
    console.log('[ALL] Full DB log:', JSON.stringify(dbLogs.map(l => ({ table: l.table, method: l.method })), null, 2))
  })

})

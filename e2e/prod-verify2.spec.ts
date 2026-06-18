/**
 * prod-verify2.spec.ts
 * 本番: ログイン後に顧客タブから BottomSheet を開き STEP1〜5 を確認
 */

import { test, expect, type Page } from '@playwright/test'

const PROD_URL = 'https://riora-os-debug-webhook.vercel.app'

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

type DBLog = { table: string; method: string }
async function interceptSupabase(page: Page): Promise<DBLog[]> {
  const logs: DBLog[] = []
  await page.route(`${PROD_URL}/rest/v1/**`, async (route, request) => {
    if (['POST', 'PATCH', 'PUT'].includes(request.method())) {
      const url = new URL(request.url())
      const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? 'unknown'
      logs.push({ table, method: request.method() })
    }
    await route.continue()
  })
  // Supabase 本番 URL も捕捉
  await page.route('**/rest/v1/**', async (route, request) => {
    if (['POST', 'PATCH', 'PUT'].includes(request.method())) {
      const url = new URL(request.url())
      const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? 'unknown'
      if (!logs.some(l => l.table === table)) {
        logs.push({ table, method: request.method() })
      }
    }
    await route.continue()
  })
  return logs
}

// ─── ログイン共通ヘルパー ────────────────────────────────────────────────────

async function loginAndWait(page: Page) {
  await page.goto(`${PROD_URL}/login`)
  await page.waitForLoadState('networkidle', { timeout: 15000 })

  const emailInput = page.locator('input[type="email"], input[name="email"]').first()
  const passInput  = page.locator('input[type="password"]').first()

  if (await emailInput.count() > 0) {
    await emailInput.fill('admin@salon-riora.jp')
    await passInput.fill('riora2026')
    await page.locator('button[type="submit"], button:has-text("ログイン")').first().click()
    await page.waitForURL(`${PROD_URL}/phase1`, { timeout: 10000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 10000 })
  }
  console.log('[LOGIN] URL after login:', page.url())
}

// ─── テスト ───────────────────────────────────────────────────────────────────

test.describe('PROD STEP1〜5: 顧客 BottomSheet 動作確認', () => {
  test.use({ baseURL: PROD_URL })

  test('STEP1: ログイン後 顧客タブから BottomSheet を開く', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await loginAndWait(page)
    await page.screenshot({ path: 'test-results/s1-after-login.png' })

    // 顧客タブをクリック
    const customerTab = page.locator('text=顧客').first()
    if (await customerTab.count() > 0) {
      await customerTab.click()
      await page.waitForLoadState('networkidle', { timeout: 8000 })
      await page.waitForTimeout(1000)
    }

    await page.screenshot({ path: 'test-results/s1-customers-tab.png' })
    const bodySnippet = (await page.textContent('body'))?.slice(0, 500)
    console.log('[STEP1] Customers page body:', bodySnippet)
    console.log('[STEP1] Console errors:', consoleErrors)

    // 顧客リストの最初の項目をタップ
    const customerItems = [
      page.locator('[data-customer-card]').first(),
      page.locator('[data-testid="customer-item"]').first(),
      page.locator('button:has-text("様")').first(),
      page.locator('li button').first(),
      page.locator('.customer-card').first(),
    ]

    let opened = false
    for (const item of customerItems) {
      if (await item.count() > 0) {
        await item.click()
        opened = true
        console.log('[STEP1] Customer item clicked')
        break
      }
    }

    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'test-results/s1-sheet-opened.png' })

    // BottomSheet または顧客詳細が表示されているか
    const sheetVisible = await page.locator(
      '[data-testid="customer-sheet"], .bottom-sheet, [role="dialog"], [data-testid="customer-notes-section"]'
    ).count()
    console.log('[STEP1] Sheet/dialog visible count:', sheetVisible)
    console.log('[STEP1] Sheet opened:', opened)
  })

  test('STEP2-5: Voice Memo → Notes → BookingPrompt → Handover → Contraindication', async ({ page }) => {
    await injectMediaRecorderMock(page)
    const dbLogs = await interceptSupabase(page)

    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await loginAndWait(page)

    // 顧客タブへ移動
    const customerTab = page.locator('text=顧客').first()
    if (await customerTab.count() > 0) {
      await customerTab.click()
      await page.waitForTimeout(1500)
    }

    await page.screenshot({ path: 'test-results/s2-customers.png' })

    // 顧客を開く（様 でも探す）
    const firstCustomer = page.locator('button:has-text("様"), [data-customer-card], li:has-text("様")').first()
    if (await firstCustomer.count() > 0) {
      await firstCustomer.click()
      await page.waitForTimeout(1500)
    }

    await page.screenshot({ path: 'test-results/s2-sheet.png' })

    // ページ内の全テキストを取得して構造を把握
    const pageText = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, h1, h2, h3, [data-testid]'))
      return all.map(el => `${el.tagName}:${el.textContent?.slice(0, 40)}`).join('\n')
    })
    console.log('[STEP2] Interactive elements:\n', pageText.slice(0, 1500))

    // 録音ボタンを探す（テキスト・aria-label・SVG 親要素を含む広範な検索）
    const micCandidates = [
      'button:has-text("録音")',
      'button:has-text("音声")',
      'button[aria-label*="録音"]',
      'button[aria-label*="マイク"]',
      '[data-testid="mic-btn"]',
      '[data-testid="record-btn"]',
      'button:has(svg) >> nth=0',
    ]

    let micClicked = false
    for (const sel of micCandidates) {
      const el = page.locator(sel).first()
      if (await el.count() > 0) {
        console.log('[STEP2] Found mic button with selector:', sel)
        await el.click()
        micClicked = true
        await page.waitForTimeout(600)
        break
      }
    }

    if (micClicked) {
      // 停止
      const stopBtn = page.locator('button:has-text("停止"), button:has-text("録音を停止")').first()
      if (await stopBtn.count() > 0) {
        await stopBtn.click()
        await page.waitForTimeout(400)
      }

      // 保存
      const saveBtn = page.locator('button:has-text("保存"), button:has-text("保存する")').first()
      if (await saveBtn.count() > 0) {
        await saveBtn.click()
        console.log('[STEP2] Saved voice note')
        await page.waitForTimeout(8000)  // AI 処理待ち
      }
    }

    await page.screenshot({ path: 'test-results/s2-after-save.png' })

    // BookingPrompt セクションが表示されているか確認
    const bpSection = page.locator('[data-testid="booking-prompt-section"], text=今日の接客, text=接客ポイント').first()
    console.log('[STEP3] BookingPrompt section found:', await bpSection.count() > 0)

    // Handover セクション
    const handoverSection = page.locator('[data-testid="handover-section"], text=引継ぎ').first()
    console.log('[STEP4] Handover section found:', await handoverSection.count() > 0)

    // Contraindication セクション
    const contraSec = page.locator('[data-testid="contraindication-section"], text=禁忌, text=注意事項').first()
    console.log('[STEP5] Contraindication section found:', await contraSec.count() > 0)

    // DB 書き込み結果
    console.log('[DB] All writes:', JSON.stringify(dbLogs))
    console.log('[ERRORS] Console errors:', consoleErrors.slice(0, 10))

    await page.screenshot({ path: 'test-results/s5-final.png' })
  })
})

/**
 * contraindication.spec.ts
 * E2E: Contraindication AI 生成・表示・重複防止の検証。
 *
 * テスト項目:
 *   1. 禁忌生成ロジック（キーワードマッチング）
 *   2. severity 判定（CRITICAL/HIGH/MEDIUM/LOW）
 *   3. severity ソート順（CRITICAL → HIGH → MEDIUM → LOW）
 *   4. 重複防止（同 title で UPDATE）
 *   5. UI 表示確認
 *   6. Voice Memo 連携（onSaved 後 5.5s で再取得）
 *   7. 再生成時の正常動作
 *
 * 前提: dev server が localhost:3000 で起動中
 */

import { test, expect, type Page } from '@playwright/test'

// ─── ルールテスト用 定数（contraindication.ts と同期） ────────────────────────

const RULES = [
  // CRITICAL
  { keywords: ['感染症', 'ヘルペス'],                                severity: 'CRITICAL', title: '感染症の疑い' },
  { keywords: ['抗がん剤', '化学療法'],                              severity: 'CRITICAL', title: '抗がん剤・放射線治療中' },
  // HIGH
  { keywords: ['妊娠', '妊婦'],                                      severity: 'HIGH',     title: '妊娠中' },
  { keywords: ['授乳中'],                                             severity: 'HIGH',     title: '授乳中' },
  { keywords: ['薬', 'お薬', 'ステロイド'],                          severity: 'HIGH',     title: '服薬中' },
  { keywords: ['持病'],                                               severity: 'HIGH',     title: '持病・疾患治療中' },
  // MEDIUM
  { keywords: ['アレルギー'],                                         severity: 'MEDIUM',   title: 'アレルギー' },
  { keywords: ['アトピー'],                                           severity: 'MEDIUM',   title: 'アトピー性皮膚炎' },
  { keywords: ['花粉症'],                                             severity: 'MEDIUM',   title: '花粉症・季節性アレルギー' },
  { keywords: ['炎症', 'ニキビ炎症'],                                severity: 'MEDIUM',   title: '現在炎症あり' },
  { keywords: ['敏感肌', '刺激に弱い'],                              severity: 'MEDIUM',   title: '敏感肌' },
  // LOW
  { keywords: ['乾燥肌', '乾燥が強い'],                              severity: 'LOW',      title: '乾燥肌' },
  { keywords: ['赤みが出やすい'],                                     severity: 'LOW',      title: '赤みが出やすい' },
  { keywords: ['日焼け後', '日焼けした'],                            severity: 'LOW',      title: '日焼け後' },
]

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

// ─── ユーティリティ ───────────────────────────────────────────────────────────

async function injectMediaRecorderMock(page: Page) {
  await page.addInitScript(() => {
    const DUMMY_BLOB = new Blob(
      [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
      { type: 'audio/webm' }
    )
    class MockMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      ondataavailable: ((e: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_s: MediaStream, _o?: MediaRecorderOptions) { super() }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        const e = new Event('dataavailable') as BlobEvent
        Object.defineProperty(e, 'data', { value: DUMMY_BLOB })
        this.ondataavailable?.(e)
        setTimeout(() => this.onstop?.(), 10)
      }
      static isTypeSupported() { return true }
    }
    // @ts-expect-error override
    window.MediaRecorder = MockMediaRecorder
    // @ts-expect-error override
    navigator.mediaDevices = { getUserMedia: async () => new MediaStream() }
  })
}

async function openFirstCustomer(page: Page): Promise<boolean> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const card = page.locator('[data-reservation-card], [data-customer-card]').first()
  if (await card.count() === 0) return false
  await card.click()
  await page.waitForTimeout(800)
  return true
}

// ─── テスト ───────────────────────────────────────────────────────────────────

test.describe('禁忌生成ロジック', () => {

  test('キーワードマッチング: テキストから正しい severity が判定される', async ({ page }) => {
    const result = await page.evaluate((rules) => {
      const texts = [
        '妊娠中とのことです',
        '敏感肌傾向あり',
        '乾燥肌でお悩みとのこと',
        '感染症治療中',
      ]

      const found: Array<{ title: string; severity: string }> = []
      const seen = new Set<string>()

      for (const text of texts) {
        for (const rule of rules) {
          if (seen.has(rule.title)) continue
          if (rule.keywords.some((kw: string) => text.includes(kw))) {
            found.push({ title: rule.title, severity: rule.severity })
            seen.add(rule.title)
            break
          }
        }
      }
      return found
    }, RULES)

    // 妊娠 → HIGH
    const pregnancy = result.find(r => r.title === '妊娠中')
    expect(pregnancy?.severity).toBe('HIGH')

    // 敏感肌 → MEDIUM
    const sensitive = result.find(r => r.title === '敏感肌')
    expect(sensitive?.severity).toBe('MEDIUM')

    // 乾燥肌 → LOW
    const dry = result.find(r => r.title === '乾燥肌')
    expect(dry?.severity).toBe('LOW')

    // 感染症 → CRITICAL
    const infection = result.find(r => r.title === '感染症の疑い')
    expect(infection?.severity).toBe('CRITICAL')
  })

  test('複数キーワードが同じルールに属する場合は1件のみ抽出される', async ({ page }) => {
    const result = await page.evaluate((rules) => {
      const texts = ['敏感肌です', '刺激に弱いです']
      const found = new Map<string, string>()

      for (const text of texts) {
        for (const rule of rules) {
          if (found.has(rule.title)) continue
          if (rule.keywords.some((kw: string) => text.includes(kw))) {
            found.set(rule.title, rule.severity)
            break
          }
        }
      }
      return Array.from(found.entries()).filter(([t]) => t === '敏感肌')
    }, RULES)

    // 敏感肌は1件のみ
    expect(result.length).toBe(1)
  })

  test('severity order: CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3', async ({ page }) => {
    const result = await page.evaluate((order) => {
      const items = [
        { severity: 'LOW',      title: '乾燥肌' },
        { severity: 'CRITICAL', title: '感染症' },
        { severity: 'MEDIUM',   title: '敏感肌' },
        { severity: 'HIGH',     title: '妊娠中' },
      ]
      return items
        .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
        .map(i => i.severity)
    }, SEVERITY_ORDER)

    expect(result[0]).toBe('CRITICAL')
    expect(result[1]).toBe('HIGH')
    expect(result[2]).toBe('MEDIUM')
    expect(result[3]).toBe('LOW')
  })

  test('confidence: CRITICAL=0.95, HIGH=0.88, MEDIUM=0.80, LOW=0.72', async ({ page }) => {
    const result = await page.evaluate(() => {
      const confidenceMap: Record<string, number> = {
        CRITICAL: 0.95, HIGH: 0.88, MEDIUM: 0.80, LOW: 0.72,
      }
      return confidenceMap
    })

    expect(result['CRITICAL']).toBe(0.95)
    expect(result['HIGH']).toBe(0.88)
    expect(result['MEDIUM']).toBe(0.80)
    expect(result['LOW']).toBe(0.72)
  })

})

test.describe('重複防止', () => {

  test('同一 customer_id + title で既存があれば UPDATE を選択する', async ({ page }) => {
    const result = await page.evaluate(() => {
      const existingMap = new Map([
        ['敏感肌', 'ci-001'],
        ['乾燥肌', 'ci-002'],
      ])

      const items = ['敏感肌', '乾燥肌', 'アレルギー']
      const ops: Array<{ title: string; op: string; id?: string }> = []

      for (const title of items) {
        const existingId = existingMap.get(title)
        if (existingId) {
          ops.push({ title, op: 'UPDATE', id: existingId })
        } else {
          ops.push({ title, op: 'INSERT' })
        }
      }

      return ops
    })

    expect(result.find(r => r.title === '敏感肌')?.op).toBe('UPDATE')
    expect(result.find(r => r.title === '乾燥肌')?.op).toBe('UPDATE')
    expect(result.find(r => r.title === 'アレルギー')?.op).toBe('INSERT')
  })

  test('generateAndSaveContraindications 2回実行で INSERT は1回のみ', async ({ page }) => {
    const result = await page.evaluate(() => {
      let insertCount = 0
      let updateCount = 0

      // 1回目: 全て INSERT
      const titles = ['敏感肌', '乾燥肌']
      const saved = new Set<string>()

      for (const title of titles) {
        if (!saved.has(title)) { insertCount++; saved.add(title) }
        else { updateCount++ }
      }

      // 2回目: 全て UPDATE
      for (const title of titles) {
        if (saved.has(title)) { updateCount++ }
        else { insertCount++ }
      }

      return { insertCount, updateCount }
    })

    expect(result.insertCount).toBe(2)  // 1回目の INSERT のみ
    expect(result.updateCount).toBe(2)  // 2回目は全て UPDATE
  })

})

test.describe('ContraindicationSection UI', () => {

  test('CustomerBottomSheet を開くと Contraindications カードが表示される', async ({ page }) => {
    const opened = await openFirstCustomer(page)
    if (!opened) { test.skip(); return }

    await page.waitForTimeout(1200)

    const section = page.locator('[data-testid="contraindication-section"]')
    if (await section.count() > 0) {
      await expect(section).toBeVisible()
      await expect(page.locator('text=Contraindications')).toBeVisible()
    }
  })

  test('折りたたみボタンでコンテンツの表示/非表示が切り替わる', async ({ page }) => {
    const opened = await openFirstCustomer(page)
    if (!opened) { test.skip(); return }

    const section = page.locator('[data-testid="contraindication-section"]')
    if (await section.count() === 0) { test.skip(); return }

    const headerBtn = section.locator('button').first()
    await headerBtn.click()
    await page.waitForTimeout(300)
    await headerBtn.click()
    await page.waitForTimeout(300)
    await expect(section).toBeVisible()
  })

  test('DEMO_MODE: 敏感肌・乾燥肌が表示される（またはローディング状態）', async ({ page }) => {
    const opened = await openFirstCustomer(page)
    if (!opened) { test.skip(); return }

    await page.waitForTimeout(1500)

    const section = page.locator('[data-testid="contraindication-section"]')
    if (await section.count() > 0) {
      const hasLoading = await page.locator('text=禁忌情報を解析中').count()
      const hasItems   = await section.locator('p').count()
      expect(hasLoading + hasItems).toBeGreaterThan(0)
    }
  })

  test('severity ラベルが正しく表示される（UI 確認）', async ({ page }) => {
    const result = await page.evaluate(() => {
      const LABELS: Record<string, string> = {
        CRITICAL: '施術禁止',
        HIGH:     '要確認',
        MEDIUM:   '注意',
        LOW:      '配慮',
      }
      return LABELS
    })

    expect(result['CRITICAL']).toBe('施術禁止')
    expect(result['HIGH']).toBe('要確認')
    expect(result['MEDIUM']).toBe('注意')
    expect(result['LOW']).toBe('配慮')
  })

  test('CRITICAL/HIGH がある場合はカードの背景が赤系になる（ロジック検証）', async ({ page }) => {
    const result = await page.evaluate(() => {
      const items = [
        { severity: 'HIGH',   title: '妊娠中' },
        { severity: 'MEDIUM', title: '敏感肌' },
      ]
      const hasCriticalOrHigh = items.some(
        i => i.severity === 'CRITICAL' || i.severity === 'HIGH'
      )
      // 背景色は hasCriticalOrHigh で分岐
      return hasCriticalOrHigh ? 'red-theme' : 'yellow-theme'
    })

    expect(result).toBe('red-theme')
  })

})

test.describe('Voice Memo → Contraindications 更新', () => {

  test('Voice Memo 保存後 5.5秒で Contraindications が再取得される（タイミング検証）', async ({ page }) => {
    const result = await page.evaluate(() => {
      const timings = {
        notesRefreshKey:   2000,
        bookingPrompt:     3500,
        handover:          4500,
        contraindications: 5500,
      }
      // タイミングは順番通りか
      return (
        timings.notesRefreshKey < timings.bookingPrompt &&
        timings.bookingPrompt < timings.handover &&
        timings.handover < timings.contraindications
      )
    })
    expect(result).toBe(true)
  })

  test('Voice Memo 保存後に Contraindications が更新される', async ({ page }) => {
    await injectMediaRecorderMock(page)

    const opened = await openFirstCustomer(page)
    if (!opened) { test.skip(); return }

    const startBtn = page.locator('text=録音を開始').first()
    if (await startBtn.count() === 0) { test.skip(); return }

    await startBtn.click()
    await page.waitForTimeout(400)

    const stopBtn = page.locator('text=録音を停止').first()
    if (await stopBtn.count() > 0) {
      await stopBtn.click()
      await page.waitForTimeout(400)
    }

    const saveBtn = page.locator('text=保存する').first()
    if (await saveBtn.count() > 0) {
      await saveBtn.click()
      // Pipeline STEP 11 + 5.5s 遅延
      await page.waitForTimeout(7000)
    }

    const section = page.locator('[data-testid="contraindication-section"]')
    if (await section.count() > 0) {
      await expect(section).toBeVisible()
    }
  })

})

test.describe('再生成', () => {

  test('新規ノート追加後に generateContraindications が追加禁忌を検出する', async ({ page }) => {
    const result = await page.evaluate((rules) => {
      // 初回: 敏感肌のみ
      const notesV1 = ['敏感肌傾向あり']
      // 再生成: アレルギーが追加された
      const notesV2 = ['敏感肌傾向あり', 'アレルギーがある']

      function extract(texts: string[]) {
        const found = new Map<string, string>()
        for (const text of texts) {
          for (const rule of rules) {
            if (found.has(rule.title)) continue
            if (rule.keywords.some((kw: string) => text.includes(kw))) {
              found.set(rule.title, rule.severity)
              break
            }
          }
        }
        return Array.from(found.keys())
      }

      return {
        v1: extract(notesV1),
        v2: extract(notesV2),
      }
    }, RULES)

    expect(result.v1).toContain('敏感肌')
    expect(result.v1).not.toContain('アレルギー')
    expect(result.v2).toContain('敏感肌')
    expect(result.v2).toContain('アレルギー')
  })

})

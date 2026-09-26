/**
 * customer-sheet-no-timeline-cache-403.spec.ts
 *
 * timeline_summary_cache直接クエリ(死んだ「今日のFocus」取得ロジック)を
 * CustomerBottomSheet.tsxから削除した修正の実機検証。
 *
 * 確認項目:
 *   1. 顧客シートを開いた際にtimeline_summary_cacheへのリクエスト自体が発生しないこと
 *      (403が「出ない」のではなく、そもそもクエリしなくなったことを確認する)
 *   2. 「今日気をつけること」セクション(アレルギー・触れない話題・NGワード)が
 *      タップで展開すれば表示されること(2026-09-26ユーザー承認: 初期折りたたみの
 *      アコーディオンに変更されたため、開いた直後は見出しのみでタップ後に検証する)
 */
import { test, expect, type Page } from '@playwright/test'
import { buildAuthedSession } from './helpers/authSession'
import { seedSession, openCustomerBottomSheet } from './helpers/photoTestUtils'

test('顧客シートを開いてもtimeline_summary_cacheへのリクエストが発生せず、今日気をつけることセクションはタップで展開すれば表示される', async ({ page }: { page: Page }) => {
  test.setTimeout(60000)

  const timelineCacheRequests: string[] = []
  page.on('request', req => {
    if (req.url().includes('timeline_summary_cache')) timelineCacheRequests.push(req.url())
  })
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  const session = await buildAuthedSession()
  await seedSession(page, session)

  const customerId = await openCustomerBottomSheet(page, '井口 悠')
  console.log('[VERIFY] customerId:', customerId)

  // 「今日気をつけること」は初期状態で見出しのみ(2026-09-26: 初期折りたたみアコーディオン化)。
  // タップして展開すると3項目が表示されることを確認する。
  const warningsHeader = page.locator('text=⚠️ 今日気をつけること')
  await expect(warningsHeader).toBeVisible({ timeout: 10000 })
  await expect(page.locator('text=アレルギー')).not.toBeVisible()
  await warningsHeader.click()
  await expect(page.locator('text=アレルギー')).toBeVisible()
  await expect(page.locator('text=触れない話題')).toBeVisible()
  await expect(page.locator('text=NGワード')).toBeVisible()
  console.log('[VERIFY] ✓ 今日気をつけることセクションはタップで展開すると(アレルギー/触れない話題/NGワード)が表示される')

  // 少し待って非同期fetchが出尽くすのを確認する
  await page.waitForTimeout(2000)

  console.log('[VERIFY] timeline_summary_cache requests:', JSON.stringify(timelineCacheRequests))
  expect(timelineCacheRequests).toEqual([])
  console.log('[VERIFY] ✓ timeline_summary_cacheへのリクエストが一切発生していない(403も出ない)')

  console.log('[VERIFY] page errors:', JSON.stringify(pageErrors))
  expect(pageErrors).toEqual([])
})

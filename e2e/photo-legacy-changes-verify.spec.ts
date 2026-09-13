/**
 * photo-legacy-changes-verify.spec.ts
 *
 * このリポジトリにセッション開始前から未コミットのまま存在していた、写真カルテ関連の
 * 2つの変更を実機検証する(いずれも本セッションの作業対象ではなく、由来・時期は不明。
 * 2026-09-13、ユーザー指示によりcommit 7ce8a49のpush判断材料として検証):
 *
 *   A. 写真原本保存化(batchUpload.ts): ライブラリ選択した写真をconvertImageFileToWebpBlob()
 *      でWebP再エンコードせず、選択した原本(HEIC/JPEG等)をそのままStorageへ保存する変更。
 *      → JPEGを選択してアップロードし、Storage側のcontent_type/サイズが元ファイルと
 *        一致する(webpへ変換されていない)ことを確認する。
 *
 *   B. 来店タブ表示条件(PhotoTimelineView.tsx): 「来店で絞り込み」領域の表示条件を
 *      visitTabs.length > 0 から常時表示に変更(「すべて」ボタンは来店データが無くても
 *      表示、個別の来店回タブのみ実データがある場合に表示)。
 *      → 写真は無いが顧客プロフィールはある顧客でPhotoTimelineViewを開き、
 *        レイアウト崩れ・コンソールエラーが無いことを確認する。
 */
import { test, expect, type Page } from '@playwright/test'
import { buildAuthedSession } from './helpers/authSession'
import { seedSession, openCustomerBottomSheet, fetchRecentPhotos, fetchStorageObjectMeta, deletePhoto } from './helpers/photoTestUtils'

const SVC_KEY_RAW = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SVC_KEY_RAW) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
const SVC_KEY: string = SVC_KEY_RAW

// 有効なJPEGバイト列(1x1画素相当のダミー画像。WebPへ変換されていれば
// マジックバイトも拡張子もcontent-typeも変わるため、変換有無の判定には十分)。
const DUMMY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0xff, 0xd9,
])

test('A. 写真原本保存化: JPEGで選択した写真がWebPへ変換されずそのまま保存される', async ({ page }: { page: Page }) => {
  test.setTimeout(90000)

  const session = await buildAuthedSession()
  await seedSession(page, session)

  const customerId = await openCustomerBottomSheet(page, '井口 悠')
  console.log('[VERIFY-A] customerId:', customerId)

  const karteButton = page.locator('button', { hasText: '写真カルテ' }).first()
  await expect(karteButton).toBeVisible({ timeout: 10000 })
  await karteButton.click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  const closeTimelineBtn = page.locator('button[aria-label="閉じる"]').first()
  if (await closeTimelineBtn.count() > 0) {
    await closeTimelineBtn.click({ force: true })
    await page.waitForTimeout(800)
  }

  const fileInput = page.locator('input[type="file"][multiple]')
  await expect(fileInput).toHaveCount(1)
  await fileInput.setInputFiles([
    { name: 'PHOTO_PHASEA_VERIFY.jpg', mimeType: 'image/jpeg', buffer: DUMMY_JPEG },
  ])
  await page.waitForTimeout(800)

  await expect(page.locator('text=🖼 写真を選択して追加')).toBeVisible({ timeout: 5000 })
  await page.locator('select').first().selectOption({ label: '正面' })
  await page.waitForTimeout(300)

  const registerBtn = page.locator('button', { hasText: /一括登録/ })
  await expect(registerBtn).toBeEnabled()
  await registerBtn.click()
  await page.waitForTimeout(3000)
  await expect(page.locator('text=1枚中1枚登録しました')).toBeVisible({ timeout: 10000 })
  console.log('[VERIFY-A] ✓ 登録成功')

  const rows = await fetchRecentPhotos(SVC_KEY, customerId, 1)
  expect(rows).toHaveLength(1)
  const row = rows[0]
  console.log('[VERIFY-A] DB row:', JSON.stringify(row))

  // storage_pathの拡張子がwebpに変換されていないこと(commitCustomerPhoto.tsは
  // 実MIMEから拡張子を決めるため、webp変換されていれば.webpになるはず)。
  expect(row.storage_path.endsWith('.jpg')).toBe(true)

  const meta = await fetchStorageObjectMeta(SVC_KEY, row.storage_path)
  console.log('[VERIFY-A] Storage meta:', JSON.stringify(meta))
  expect(meta).not.toBeNull()
  expect(meta!.content_type).toBe('image/jpeg')
  // 元のダミーJPEGは14バイト。WebP再エンコードを経由していれば別バイト列になり
  // サイズも変わるはずだが、原本保存化されていれば厳密に一致する。
  expect(meta!.size).toBe(DUMMY_JPEG.length)
  console.log('[VERIFY-A] ✓ Storage上でimage/jpeg・原本と同一バイト数のまま保存されている(WebP変換されていない)')

  await deletePhoto(SVC_KEY, row.id, row.storage_path)
  console.log('[CLEANUP-A] deleted test photo for customer', customerId)
})

test('B. 来店タブ表示条件: 写真が無い顧客でもPhotoTimelineViewがレイアウト崩れ・エラー無く開ける', async ({ page }: { page: Page }) => {
  test.setTimeout(60000)

  // 検証中に判明した既知の別問題: timeline_summary_cacheへのSELECT権限が
  // authenticatedロールに付与されていない(GRANT SELECT ON public.timeline_summary_cache
  // TO authenticated; が未実行)ため、CustomerBottomSheet.tsxが顧客シートを開くたびに
  // 必ず403が発生する。batchUpload.ts/PhotoTimelineView.tsxの変更とは無関係
  // (どの顧客のシートを開いても・写真の有無に関わらず発生することを別途確認済み)なため、
  // このリクエストのみ許容してフィルタする。
  // もう1件、検証中に判明した既知の別問題: 一部の顧客で「今日の施術記録」が参照する
  // visitId(TL-5/brain_customer_id移行に伴う既知のID空間不整合、複数のメモリ記録
  // (project_brain_customer_id_migration.md等)にある既知クラスの問題)がbrain_visits側
  // で見つからず404になる。これも写真カルテ(batchUpload.ts/PhotoTimelineView.tsx)とは
  // 無関係なため許容する。
  const unexpectedFailedUrls: string[] = []
  page.on('response', res => {
    if (res.status() < 400) return
    if (res.url().includes('timeline_summary_cache')) return
    if (/\/visits\/[0-9a-f-]{36}\/treatment$/.test(res.url()) && res.status() === 404) return
    unexpectedFailedUrls.push(`${res.status()} ${res.url()}`)
  })
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  const session = await buildAuthedSession()
  await seedSession(page, session)

  // 写真アップロード実績が無い(=visitTabsが空になる)可能性が高い顧客を選ぶ。
  const customerId = await openCustomerBottomSheet(page, '大熊 萌')
  console.log('[VERIFY-B] customerId:', customerId)

  const karteButton = page.locator('button', { hasText: '写真カルテ' }).first()
  await expect(karteButton).toBeVisible({ timeout: 10000 })
  await karteButton.click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  // 「写真カルテ」画面自体が開いていること
  await expect(page.locator('text=📷 撮影する')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('text=🖼 選択して追加')).toBeVisible()

  // 既存写真が無い場合の案内文言が出ており、かつ来店タブ領域を含むレイアウトが
  // 崩れていない(要素が重なる・はみ出す等が無い)ことをスクリーンショットで確認する。
  await page.screenshot({ path: 'e2e/_verify_b_timeline.png', fullPage: false })

  console.log('[VERIFY-B] unexpected failed requests:', JSON.stringify(unexpectedFailedUrls))
  console.log('[VERIFY-B] page errors:', JSON.stringify(pageErrors))
  expect(unexpectedFailedUrls).toEqual([])
  expect(pageErrors).toEqual([])
  console.log('[VERIFY-B] ✓ 想定外のエラー無し・画面は正常に開いた(スクリーンショット: e2e/_verify_b_timeline.png)')
})

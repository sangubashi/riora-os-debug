/**
 * photo-bodypart-verify.spec.ts
 * 写真カルテ PHOTO_LABEL_REALIGN_1 実機検証 E2E テスト
 *
 * 確認項目:
 *   1. 部位が未選択のままでは「一括登録」ボタンが押せないこと
 *   2. 新しい4部位(正面・斜め・顎・額)が選択肢として表示・選択できること
 *   3. 全件選択すると登録でき、brain_customer_photosに正しいbody_partで保存されること
 *
 * 認証・操作の仕組みはe2e/helpers/参照。実行後、作成したテストデータは必ず削除する。
 */
import { test, expect, type Page } from '@playwright/test'
import { buildAuthedSession } from './helpers/authSession'
import { seedSession, openCustomerBottomSheet, fetchRecentPhotos, deletePhoto } from './helpers/photoTestUtils'

const SVC_KEY_RAW = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SVC_KEY_RAW) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
const SVC_KEY: string = SVC_KEY_RAW

const DUMMY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0xff, 0xd9,
])

test('写真ライブラリ複数選択: 部位未選択のままでは登録できず、4部位が選べ、選択後は正しく保存される', async ({ page }: { page: Page }) => {
  test.setTimeout(90000)

  const session = await buildAuthedSession()
  await seedSession(page, session)

  const customerId = await openCustomerBottomSheet(page, '井口 悠')
  console.log('[VERIFY] customerId:', customerId)

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
    { name: 'PHOTO_BODYPART_VERIFY_1.jpg', mimeType: 'image/jpeg', buffer: DUMMY_JPEG },
    { name: 'PHOTO_BODYPART_VERIFY_2.jpg', mimeType: 'image/jpeg', buffer: DUMMY_JPEG },
  ])
  await page.waitForTimeout(800)

  // ① 未選択バナー・disabledボタン
  await expect(page.locator('text=🖼 写真を選択して追加')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=部位が未選択の写真が2枚あります')).toBeVisible()
  const registerBtn = page.locator('button', { hasText: /一括登録/ })
  await expect(registerBtn).toBeDisabled()
  console.log('[VERIFY] ✓ 未選択の間は「一括登録」がdisabled')

  // ② 新しい4部位が選択肢に存在すること
  const selects = page.locator('select')
  await expect(selects).toHaveCount(2)
  const optionTexts = await selects.first().locator('option').allTextContents()
  console.log('[VERIFY] 部位の選択肢:', optionTexts)
  for (const label of ['正面', '斜め', '顎', '額']) {
    expect(optionTexts).toContain(label)
  }

  // ③ 1枚目だけ選択 → まだdisabled
  await selects.nth(0).selectOption({ label: '正面' })
  await page.waitForTimeout(300)
  await expect(page.locator('text=部位が未選択の写真が1枚あります')).toBeVisible()
  await expect(registerBtn).toBeDisabled()
  console.log('[VERIFY] ✓ 1枚目選択後もまだ1枚未選択のためdisabledを維持')

  // ④ 2枚目も選択 → enabledになる
  await selects.nth(1).selectOption({ label: '斜め' })
  await page.waitForTimeout(300)
  await expect(registerBtn).toBeEnabled()
  console.log('[VERIFY] ✓ 全件選択後は「一括登録」がenabled')

  // ⑤ 登録実行
  await registerBtn.click()
  await page.waitForTimeout(4000)
  await expect(page.locator('text=2枚中2枚登録しました')).toBeVisible({ timeout: 10000 })
  console.log('[VERIFY] ✓ 2枚とも登録成功')

  // ⑥ DB確認
  const rows = await fetchRecentPhotos(SVC_KEY, customerId, 2)
  console.log('[VERIFY] DB rows:', JSON.stringify(rows))
  expect(rows).toHaveLength(2)
  expect(rows.map(r => r.body_part).sort()).toEqual(['face_front', 'face_oblique'])

  for (const row of rows) await deletePhoto(SVC_KEY, row.id, row.storage_path)
  console.log(`[CLEANUP] deleted ${rows.length} test photo row(s) for customer ${customerId}`)
})

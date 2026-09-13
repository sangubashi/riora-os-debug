/**
 * photoTestUtils.ts — 写真カルテE2Eテスト共通ユーティリティ
 */
import type { Page } from '@playwright/test'
import type { Session } from '@supabase/supabase-js'
import { SUPABASE_PROJECT_REF } from './authSession'

const SB_URL = 'https://ohszxgajckzphhfhdrsv.supabase.co'

export async function seedSession(page: Page, session: Session) {
  await page.addInitScript((arg: { session: Session; ref: string }) => {
    window.localStorage.setItem(`sb-${arg.ref}-auth-token`, JSON.stringify(arg.session))
  }, { session, ref: SUPABASE_PROJECT_REF })
}

/**
 * 顧客一覧から指定の顧客名をクリックしてCustomerBottomSheetを開き、
 * ブラウザconsoleへの[BottomSheet] MOUNTログからcustomerIdを回収する。
 * (「様」で終わるテキストはヘッダー文言「私のお客様」等にも一致してしまうため、
 * 顧客名の完全一致に近い部分一致で狙い撃ちする)
 */
export async function openCustomerBottomSheet(page: Page, customerName: string): Promise<string> {
  let customerId = ''
  page.on('console', msg => {
    const m = msg.text().match(/customer\.id\s*:\s*([0-9a-f-]{36})/)
    if (m) customerId = m[1]
  })

  await page.goto('http://localhost:3000/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)

  await page.getByText('顧客', { exact: true }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)

  const nameEl = page.getByText(customerName, { exact: false }).first()
  await nameEl.waitFor({ state: 'visible', timeout: 10000 })
  await nameEl.click()
  await page.waitForTimeout(2000)

  if (!customerId) throw new Error(`customerId not captured for "${customerName}"`)
  return customerId
}

export async function fetchRecentPhotos(svcKey: string, customerId: string, limit = 5) {
  const res = await fetch(
    `${SB_URL}/rest/v1/brain_customer_photos?customer_id=eq.${customerId}&select=id,body_part,storage_path,created_at&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }
  )
  return (await res.json()) as { id: string; body_part: string; storage_path: string; created_at: string }[]
}

export async function fetchStorageObjectMeta(svcKey: string, storagePath: string) {
  const infoRes = await fetch(`${SB_URL}/storage/v1/object/info/customer-photos/${storagePath}`, {
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  })
  if (!infoRes.ok) return null
  return (await infoRes.json()) as { content_type?: string; size?: number }
}

export async function deletePhoto(svcKey: string, id: string, storagePath: string) {
  await fetch(`${SB_URL}/storage/v1/object/customer-photos/${storagePath}`, {
    method: 'DELETE',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  })
  await fetch(`${SB_URL}/rest/v1/brain_customer_photos?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  })
}

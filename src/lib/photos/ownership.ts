/**
 * ownership.ts — 写真カルテAPIのIDOR防止ヘルパー。
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 2節手順7(visit所属確認)・3節(所有権確認)。
 * app/api/customer-memories/[id]/route.ts の verifyOwnership() と同じ考え方
 * (操作対象レコードのcustomer_idが、リクエストのcustomer_idと一致するかを
 * 確認してから操作する)を、写真テーブル・visitテーブル向けに個別実装する。
 *
 * customer_id/visit_id/store_id間の複合的な整合性はDB制約(FK)では表現できないため
 * (PHOTO_KARTE_MIGRATION_DESIGN_1.md「store_id/customer_id/visit_id/created_byの
 * 整合性」節)、API層でのこの確認が最終防波堤になる。
 */
import { getPhotoServiceClient } from './photoDb'

/**
 * visitIdが指定されている場合、そのvisitが対象customerに属することを確認する。
 * visitIdがnull/undefinedの場合はチェック不要としてtrueを返す(単発撮影を許容)。
 */
export async function verifyVisitBelongsToCustomer(
  visitId:    string | null | undefined,
  customerId: string,
): Promise<boolean> {
  if (!visitId) return true

  const supabase = getPhotoServiceClient()
  const { data } = await supabase
    .from('brain_visits')
    .select('id')
    .eq('id', visitId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .maybeSingle()

  return !!data
}

export interface PhotoOwnershipRecord {
  id:          string
  storagePath: string
}

/**
 * 指定されたphotoIdが、対象customerに属する(論理削除されていない)写真であることを確認する。
 * 所有していない・存在しない場合は null を返す(呼び出し側は403として扱うこと。
 * customer-memoriesの既存慣行に合わせ404ではなく403に統一する、
 * PHOTO_KARTE_API_DESIGN_1.md 3節参照)。
 */
export async function verifyPhotoOwnership(
  photoId:    string,
  customerId: string,
): Promise<PhotoOwnershipRecord | null> {
  const supabase = getPhotoServiceClient()
  const { data } = await supabase
    .from('brain_customer_photos')
    .select('id, storage_path, customer_id')
    .eq('id', photoId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data || data.customer_id !== customerId) return null
  return { id: data.id as string, storagePath: data.storage_path as string }
}

/**
 * photoIdsが全て対象customerに属することを一括確認する(バッチsigned URL用)。
 * 1件でも所有権が確認できなければ空配列を返す(部分成功は返さない、
 * PHOTO_KARTE_API_DESIGN_1.md 4節)。
 */
export async function verifyPhotosOwnership(
  photoIds:   string[],
  customerId: string,
): Promise<PhotoOwnershipRecord[] | null> {
  if (photoIds.length === 0) return null

  const supabase = getPhotoServiceClient()
  const { data } = await supabase
    .from('brain_customer_photos')
    .select('id, storage_path, customer_id')
    .in('id', photoIds)
    .eq('customer_id', customerId)
    .is('deleted_at', null)

  const rows = data ?? []
  if (rows.length !== photoIds.length) return null

  return rows.map(r => ({ id: r.id as string, storagePath: r.storage_path as string }))
}

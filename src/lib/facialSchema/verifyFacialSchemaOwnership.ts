/**
 * verifyFacialSchemaOwnership.ts — 顔シェーマAPIのIDOR防止ヘルパー。
 *
 * src/lib/photos/ownership.ts の verifyPhotoOwnership() と同じ思想
 * (操作対象レコードのcustomer_idが、リクエストのcustomer_idと一致するかを
 * 確認してから操作する)を顔シェーマテーブル向けに実装する。
 *
 * visit所属確認(verifyVisitBelongsToCustomer)は写真と共通のロジックのため、
 * src/lib/photos/ownership.ts のものをそのまま再利用する(重複実装しない)。
 */
import { getFacialSchemaServiceClient } from './facialSchemaDb'

export interface FacialSchemaOwnershipRecord {
  id:         string
  customerId: string
}

/**
 * 指定されたschemaIdが、対象customerに属する(論理削除されていない)顔シェーマ記録で
 * あることを確認する。所有していない・存在しない場合は null を返す(呼び出し側は
 * 403として扱うこと。customer-memories/写真の既存慣行に合わせ404ではなく403に統一する)。
 */
export async function verifyFacialSchemaOwnership(
  schemaId:   string,
  customerId: string,
): Promise<FacialSchemaOwnershipRecord | null> {
  const supabase = getFacialSchemaServiceClient()
  const { data } = await supabase
    .from('brain_customer_facial_schemas')
    .select('id, customer_id')
    .eq('id', schemaId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data || data.customer_id !== customerId) return null
  return { id: data.id as string, customerId: data.customer_id as string }
}

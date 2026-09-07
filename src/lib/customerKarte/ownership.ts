/**
 * ownership.ts — デジタル顧客カルテ Phase1-A の所有権/整合性確認ヘルパー。
 *
 * customer_id/visit_id間の複合的な整合性はDB制約(FK)では表現できないため
 * (brain_customer_photosと同じ理由、docs/PHOTO_KARTE_MIGRATION_DESIGN_1.md参照)、
 * API層でのこの確認が最終防波堤になる。
 *
 * src/lib/photos/ownership.ts と同趣旨だが、写真機能への依存を作らないため
 * 独立して持つ(customerKarte機能群からphotosモジュールをimportしない)。
 */
import { getServiceClient } from '../../../app/lib/repos'

/**
 * visitIdが指定されている場合、そのvisitが対象customerに属し(論理削除されていない)ことを確認する。
 * visitIdがnull/undefinedの場合はチェック不要としてtrueを返す(visit紐付け無しの登録を許容する)。
 */
export async function verifyVisitBelongsToCustomer(
  visitId:    string | null | undefined,
  customerId: string,
): Promise<boolean> {
  if (!visitId) return true

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('brain_visits')
    .select('id')
    .eq('id', visitId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .maybeSingle()

  return !!data
}

/**
 * 指定されたstaffProposalIdが、対象customerに属するbrain_staff_proposals行であることを確認する。
 * 所有していない・存在しない場合はfalse(呼び出し側は404として扱う)。
 */
export async function verifyStaffProposalBelongsToCustomer(
  proposalId: string,
  customerId: string,
): Promise<boolean> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('brain_staff_proposals')
    .select('id')
    .eq('id', proposalId)
    .eq('customer_id', customerId)
    .maybeSingle()

  return !!data
}

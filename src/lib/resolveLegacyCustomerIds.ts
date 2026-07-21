/**
 * resolveLegacyCustomerIds.ts
 *
 * brain_customers.id → legacy customers.id（候補配列）への変換。
 * 元は app/api/today-briefing/route.ts 内のローカル関数だったが、
 * app/api/notifications/route.ts・app/api/admin/customer-merge/{candidates/[groupKey],execute}/route.ts
 * からも参照される共通ヘルパーのため、src/lib/ へ切り出した(CUSTOMER_MERGE_BUILD_FIX_1)。
 *
 * ID空間の注意（2026-07-03 監査で確定、2026-07-19 TODAY_BRIEFING_CUSTOMER_MAPPING_AUDIT_V1
 * により解決方式を修正）:
 *   contraindications / voice_notes / handover_notes の customer_id は
 *   legacy customers.id を参照するFK制約が付いている（brain_customers.id ではない）。
 *   customer_memories / timeline_summary_cache の customer_id は brain_customers.id 基準
 *   （canAccessCustomer.ts の実装で確認済み）。
 *   このため上記3テーブルへの問い合わせ前に resolveLegacyCustomerIds() で
 *   legacy customers.id の候補（複数）を求める。
 *   brain_customers ↔ customers はactive顧客137/137件で直接ID一致（ミラー行）が
 *   成立している（CUSTOMER_IDENTITY_AUDIT_V1.md §3-5）ため、brainCustomerId自身を
 *   第一候補とする。ミラーが無いが reservations 行が新旧両IDを偶然併記している
 *   ケース（同監査で1件確認済み）を取りこぼさないよう、reservations.customer_id
 *   経由のブリッジも第二候補として残す。
 *
 * ① brainCustomerId 自身を第一候補とする（customers 側にミラー行がある場合、
 *    直接ID一致する。TODAY_BRIEFING_CUSTOMER_MAPPING_AUDIT_V1.md §3-6でactive
 *    顧客137/137件の成立を確認済み）。
 * ② reservations.customer_id 経由のブリッジを第二候補として追加する（ミラーが
 *    無いが、同一予約行に新旧IDが偶然併記されているケースの救済。既知1件）。
 * 該当データが無い候補IDはクエリが単に0件を返すだけなので、事前の存在確認は
 * 行わない。戻り値は必ず1件以上（brainCustomerId自身）を含む。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function resolveLegacyCustomerIds(
  supabase: SupabaseClient,
  brainCustomerId: string
): Promise<string[]> {
  const ids = new Set<string>([brainCustomerId])

  const { data } = await supabase
    .from('reservations')
    .select('customer_id')
    .eq('brain_customer_id', brainCustomerId)
    .not('customer_id', 'is', null)
    .limit(1)
    .maybeSingle()
  const bridged = (data as { customer_id: string } | null)?.customer_id
  if (bridged) ids.add(bridged)

  return Array.from(ids)
}

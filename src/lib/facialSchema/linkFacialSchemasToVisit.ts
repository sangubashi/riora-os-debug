/**
 * linkFacialSchemasToVisit.ts — 顔シェーマ「未紐付けデータ→visit自動紐付け」(Phase 7)
 *
 * POST /api/visits/service-complete でvisitが解決された(既存発見 or 新規作成)直後に、
 * 同一顧客・同一visit_dateに記録済みでvisit_idが未設定(NULL)の顔シェーマ記録を、
 * そのvisitへ紐付ける。src/lib/photos/linkPhotosToVisit.ts(写真機能の同種処理)と
 * 同じ設計方針:
 *   - brain_visitsの作成・visit_count_atの採番ロジックには一切関与しない
 *     (解決済みのvisitId/visitDateを受け取るだけの読み取り専用の下流処理)。
 *   - 過去データの自動バックフィルは行わない(customer_id一致・visit_id NULL・
 *     schema_date一致の行のみが対象。範囲を広げない)。
 *   - 呼び出し元(service-complete)を失敗させない非致命的処理として設計する
 *     (例外を投げない。エラーはok:falseで返し、呼び出し元がログに残すかを判断する)。
 *
 * 写真機能との違い: brain_customer_photos.taken_atはtimestamptzのためJST日範囲変換
 * (jstDayRangeToUtcIso)が必要だったが、brain_customer_facial_schemas.schema_dateは
 * 保存時点で既にJST暦日として確定した'date'型の値(facialSchemaSelection.tsの
 * todayJstDateStr()がPUT /facial-schemas保存時にこれを保証している)のため、
 * visitDateとの直接等価比較でよい(タイムゾーン変換は不要)。
 *
 * 顧客につき1機会=1行という部分ユニークインデックス(ux_facial_schemas_customer_visit)が
 * あるため、対象顧客に既にそのvisit_idの行が存在する場合(通常起こらない想定外のケース)は
 * UPDATEがユニーク制約違反(23505)になる。この場合もエラーとして扱い、どちらの行が正なのかを
 * 推測で決めない(写真機能の「推測で実装しない」方針と同じ)。
 */
import { getFacialSchemaServiceClient } from './facialSchemaDb'

export interface LinkFacialSchemasToVisitParams {
  customerId: string
  /** brain_visits.id(呼び出し元で解決済みのvisit)。 */
  visitId: string
  /** brain_visits.visit_date('YYYY-MM-DD'、JST暦日)。brain_customer_facial_schemas.schema_dateと同じ形式。 */
  visitDate: string
}

export async function linkDraftFacialSchemaToVisit(
  params: LinkFacialSchemasToVisitParams
): Promise<{ ok: true; linkedCount: number } | { ok: false; error: string }> {
  const { customerId, visitId, visitDate } = params

  try {
    const sb = getFacialSchemaServiceClient()
    const { data, error } = await sb
      .from('brain_customer_facial_schemas')
      .update({ visit_id: visitId })
      .eq('customer_id', customerId)
      .is('visit_id', null)
      .is('deleted_at', null)
      .eq('schema_date', visitDate)
      .select('id')

    if (error) return { ok: false, error: error.message }
    return { ok: true, linkedCount: data?.length ?? 0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

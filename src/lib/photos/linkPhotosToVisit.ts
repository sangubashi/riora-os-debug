/**
 * linkPhotosToVisit.ts — 写真カルテ「写真→visit自動紐付け」Phase 1
 *
 * POST /api/visits/service-complete でvisitが解決された(既存発見 or 新規作成)直後に、
 * 同一顧客・同一visit_date(JST暦日)に撮影済みでvisit_idが未設定(NULL)の写真を、
 * そのvisitへ一括でUPDATEする。
 *
 * 絶対にやらないこと(READ ONLY設計レビューでの決定事項):
 *   - brain_visitsの作成・visit_count_atの採番ロジックには一切関与しない
 *     (このモジュールは解決済みのvisitId/visitDateを受け取るだけの読み取り専用の下流処理)。
 *   - capture_session_id等の新しい識別子は導入しない。
 *   - 過去写真の自動バックフィルは行わない(customer_id一致かつvisit_id NULLの写真のうち、
 *     "同一visit_date当日"という条件に一致するものだけが対象。範囲を広げない)。
 *
 * タイムゾーン方針:
 *   visit_date('YYYY-MM-DD')は日本時間(Asia/Tokyo)の暦日として扱う。taken_at(timestamptz)を
 *   UTC日付のまま単純比較すると日本時間の日付境界(UTC+9)付近でズレるため、
 *   「その暦日のJST 00:00〜24:00」をUTC時刻範囲に変換してtaken_atと比較する。
 *   日本標準時は年間を通じて常にUTC+9固定(夏時間が無い)ため、タイムゾーンDBを使わずとも
 *   `${visitDate}T00:00:00+09:00` という固定オフセット表記だけで安全に計算できる。
 */
import { getPhotoServiceClient } from './photoDb'

export interface JstDayRangeUtc {
  /** JST暦日の開始時刻(UTC ISO文字列、範囲の下限・含む)。 */
  startUtc: string
  /** JST暦日の終了時刻(UTC ISO文字列、範囲の上限・含まない)。 */
  endUtc: string
}

/**
 * visitDate('YYYY-MM-DD'、JST暦日という前提)のJST 00:00〜24:00を
 * UTC ISO文字列の半開区間 [startUtc, endUtc) に変換する。
 */
export function jstDayRangeToUtcIso(visitDate: string): JstDayRangeUtc {
  const start = new Date(`${visitDate}T00:00:00+09:00`)
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startUtc: start.toISOString(), endUtc: end.toISOString() }
}

export interface LinkPhotosToVisitParams {
  customerId: string
  /** brain_visits.id(呼び出し元で解決済みのvisit)。 */
  visitId: string
  /** brain_visits.visit_date('YYYY-MM-DD'、JST暦日として扱う)。 */
  visitDate: string
}

/**
 * customer_id一致・visit_id IS NULL・deleted_at IS NULL・taken_atがvisitDate当日(JST)の
 * 写真を、visitIdへ一括UPDATEする。
 *
 * 呼び出し元(service-complete)を失敗させない非致命的処理として設計されているため、
 * 例外は投げない(Supabaseエラー・env未設定等はすべてcatchしてok:falseで返す)。
 * 呼び出し元は結果をログに残すかどうかを判断する(このモジュール自体はログ出力しない)。
 */
export async function linkUnattachedPhotosToVisit(
  params: LinkPhotosToVisitParams
): Promise<{ ok: true; linkedCount: number } | { ok: false; error: string }> {
  const { customerId, visitId, visitDate } = params
  const { startUtc, endUtc } = jstDayRangeToUtcIso(visitDate)

  try {
    const sb = getPhotoServiceClient()
    const { data, error } = await sb
      .from('brain_customer_photos')
      .update({ visit_id: visitId })
      .eq('customer_id', customerId)
      .is('visit_id', null)
      .is('deleted_at', null)
      .gte('taken_at', startUtc)
      .lt('taken_at', endUtc)
      .select('id')

    if (error) return { ok: false, error: error.message }
    return { ok: true, linkedCount: data?.length ?? 0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

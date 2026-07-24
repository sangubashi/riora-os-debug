/**
 * csvTypeDetector.ts — CSVファイル形式の自動判定(売上明細/予約/不明)
 *
 * アップロード時にヘッダー行を解析して形式を判定し、画面に判定結果を表示する。
 * SalonBoard売上明細CSV → 'detail'
 * 予約CSV              → 'reservation'(予約Import機能はRES-2〜RES-9で実装済み。
 *                          infoMessageは付与しない。画面側は予約専用Dry Run
 *                          エンドポイント(/api/admin/csv/reservation-dry-run)の
 *                          結果を表示する)
 * その他               → 'unknown'
 *
 * 列名ゆらぎ吸収はsalonBoardDetailParser.tsのresolveDetailHeader()を共用する。
 */
import { resolveDetailHeader } from './salonBoardDetailParser'

export type CsvType = 'detail' | 'reservation' | 'unknown'

export interface CsvTypeDetectionResult {
  type: CsvType
  infoMessage: string | null
}

const DETAIL_REQUIRED_COLUMNS = ['会計ID', '会計日', 'スタッフ', '区分', '金額']
const DETAIL_MATCH_THRESHOLD = 4

// reservationCsvParser.ts の REQUIRED_HEADERS と一致させる(実際のSalonBoard予約一覧CSVの
// 実ヘッダーで検証済み。旧シグナル(予約日/予約時間/予約メニュー/施術者/来店予定時刻/
// 施術時間/予約ステータス)は実CSVに存在しない想定上の列名だったため、detectCsvType()が
// 'unknown'と誤判定し、予約CSVが売上CSV用パーサーに回されてmissing_required_columnsで
// 400になるバグの原因だった)。
const RESERVATION_SIGNALS = new Set([
  'ステータス', 'スタッフ名', '来店日', '開始時間', '終了時間', '所要時間',
  'お名前', '予約時合計金額',
])

export function detectCsvType(rawHeaders: string[]): CsvTypeDetectionResult {
  const resolved = rawHeaders.map(resolveDetailHeader)

  const detailMatchCount = DETAIL_REQUIRED_COLUMNS.filter(r => resolved.includes(r)).length
  if (detailMatchCount >= DETAIL_MATCH_THRESHOLD) {
    return { type: 'detail', infoMessage: null }
  }

  const reservationMatchCount = rawHeaders.filter(h => RESERVATION_SIGNALS.has(h)).length
  if (reservationMatchCount >= 2) {
    return { type: 'reservation', infoMessage: null }
  }

  return { type: 'unknown', infoMessage: null }
}

/** CSVテキストの先頭行を解析してヘッダー一覧を返す(type-detection専用の軽量パーサー)。 */
export function parseHeadersFromCsv(csvText: string): string[] {
  const firstLine = (csvText.split(/\r?\n/)[0] ?? '').trim()
  if (!firstLine) return []
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]
    if (ch === '"') {
      if (inQuote && firstLine[i + 1] === '"') { current += '"'; i++ }
      else { inQuote = !inQuote }
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

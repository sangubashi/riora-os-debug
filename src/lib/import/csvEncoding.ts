/**
 * csvEncoding.ts — SalonBoard CSV(SJIS/UTF-8どちらも許容)のデコード
 *
 * SalonBoardの標準CSVエクスポートはShift_JISだが、運用者が一度Excel等で
 * 開き直して保存するとUTF-8(BOM付き含む)になる場合がある。両対応のため
 * まずUTF-8として読み、文字化け(U+FFFD)または必須ヘッダーが見えない場合に
 * Shift_JISへフォールバックする(MIMEタイプはあてにしない・内容ベースで判定)。
 *
 * 売上明細CSV(会計ID列を持つ)と予約一覧CSV(会計ID列を持たない)の両方を
 * 判定できるよう、ヘッダーヒントは「いずれか1つでも含まれていればOK」とする
 * (予約一覧CSVには会計IDが存在しないため、単一ヒントのみだと誤ってSJIS→UTF-8
 * 誤判定のままヘッダー検出に失敗し missing_required_columns になっていた)。
 */
import * as iconv from 'iconv-lite'

const REQUIRED_HEADER_HINTS = [
  '会計ID', // 売上明細CSV
  'ステータス', 'スタッフ名', '来店日', '開始時間', '終了時間', '所要時間', 'お名前', '予約時合計金額', // 予約一覧CSV
]

function hasExpectedHeader(text: string): boolean {
  return REQUIRED_HEADER_HINTS.some(hint => text.includes(hint))
}

export function decodeCsvBuffer(buf: Buffer): string {
  const utf8 = buf.toString('utf-8').replace(/^﻿/, '')
  const looksBroken = utf8.includes('�')

  if (!looksBroken && hasExpectedHeader(utf8)) return utf8

  const sjis = iconv.decode(buf, 'Shift_JIS')
  if (hasExpectedHeader(sjis)) return sjis

  return utf8
}

/**
 * csvEncoding.ts — SalonBoard CSV(SJIS/UTF-8どちらも許容)のデコード
 *
 * SalonBoardの標準CSVエクスポートはShift_JISだが、運用者が一度Excel等で
 * 開き直して保存するとUTF-8(BOM付き含む)になる場合がある。両対応のため
 * まずUTF-8として読み、文字化け(U+FFFD)または必須ヘッダーが見えない場合に
 * Shift_JISへフォールバックする(MIMEタイプはあてにしない・内容ベースで判定)。
 */
import * as iconv from 'iconv-lite'

const REQUIRED_HEADER_HINT = '会計ID'

export function decodeCsvBuffer(buf: Buffer): string {
  const utf8 = buf.toString('utf-8').replace(/^﻿/, '')
  const looksBroken = utf8.includes('�')
  const hasExpectedHeader = utf8.includes(REQUIRED_HEADER_HINT)

  if (!looksBroken && hasExpectedHeader) return utf8

  const sjis = iconv.decode(buf, 'Shift_JIS')
  if (sjis.includes(REQUIRED_HEADER_HINT)) return sjis

  return utf8
}

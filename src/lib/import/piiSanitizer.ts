/**
 * piiSanitizer.ts — CSV取込のPII残留検査・会員番号ハッシュ化
 *
 * 設計根拠: docs/architecture/CSVImportSecurityArchitecture.md §3-1
 *
 * salonBoardDetailParser.tsが読み取るSalonBoard売上明細CSVには電話番号/メール/郵便番号/
 * 住所/生年月日の列が存在しない(HEADER_MAPに未定義のため、そもそもパース時点で読み取られ
 * ない=DROPが構造的に保証されている)。本モジュールが担うのは2点のみ:
 *   1. 会員番号(お客様番号) → sha256ハッシュ化(store.anonSalt併用・原値は保持しない)
 *   2. KEEP列(氏名・カナ・スタッフ名)への残存PII混入の走査(最終防衛線・pure・throwしない)
 */

import { createHash } from 'crypto'
import { toHalfWidth } from './normalizer'

const PHONE_RE  = /0\d{1,4}[-‐ー ]?\d{1,4}[-‐ー ]?\d{3,4}/
const EMAIL_RE  = /[\w.+-]+@[\w-]+\.[\w.]+/
const POSTAL_RE = /〒?\s?\d{3}[-‐ー]?\d{4}/

/** 会員番号(お客様番号)をstore.anonSalt併用でハッシュ化する。原値はどこにも保持しない。 */
export function hashExternalKey(memberNo: string, anonSalt: string): string {
  return createHash('sha256').update(`${memberNo}${anonSalt}`).digest('hex')
}

function redactResidualPii(value: string): { cleaned: string; piiFound: number } {
  let cleaned = toHalfWidth(value)
  let piiFound = 0
  for (const re of [PHONE_RE, EMAIL_RE, POSTAL_RE]) {
    if (re.test(cleaned)) {
      piiFound++
      cleaned = cleaned.replace(re, '[削除済]')
    }
  }
  return { cleaned, piiFound }
}

export interface SanitizableFields {
  customerName: string
  customerKana: string
  staffNameRaw: string
}

export interface SanitizeResult<T> {
  clean:    T
  piiFound: number
}

/** KEEP列(氏名・カナ・スタッフ名)に混入した残存PIIを検出・置換する(pure・throwしない)。 */
export function sanitizeResidualPii<T extends SanitizableFields>(row: T): SanitizeResult<T> {
  const name  = redactResidualPii(row.customerName)
  const kana  = redactResidualPii(row.customerKana)
  const staff = redactResidualPii(row.staffNameRaw)

  return {
    clean: {
      ...row,
      customerName: name.cleaned,
      customerKana: kana.cleaned,
      staffNameRaw: staff.cleaned,
    },
    piiFound: name.piiFound + kana.piiFound + staff.piiFound,
  }
}

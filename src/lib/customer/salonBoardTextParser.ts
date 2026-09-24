/**
 * salonBoardTextParser.ts — SalonBoard「お客様情報詳細」画面のテキストをそのまま
 * コピペした文字列から、顧客情報補完に必要な項目だけを抜き出す(2026-09-24ユーザー承認)。
 *
 * 対応する貼り付け形式は2種類(いずれも1項目1行で、ラベルと値の間の区切り文字
 * (タブ・スペース・無し)は問わない):
 *   1. 簡易版:  「誕生日1997/01/28」のようにラベルと値が直接連続する短い一覧
 *   2. 詳細版:  「お客様情報詳細」ページ全文(基本情報・来店情報・メッセージ配信先情報の
 *      見出しやヘルプ文言を含む、実際のコピペ結果)
 *
 * 電話番号は個人情報方針(docs/security/PII_POLICY_V1.md)により一切抽出しない
 * (このパーサー自体に電話番号用の正規表現を持たせない)。氏名(漢字)は既存顧客への
 * 追記対象ではなく確認表示専用(brain_customers.nameを上書きしない、誤表記で既存の
 * 正しい名前を壊すリスクを避けるため)。氏名(カナ)は2026-09-24ユーザー承認により
 * brain_customers.name_kanaへ保存する(フリガナ表示用、電話番号のような機微情報ではない)。
 */
import { parseFlexibleBirthDateInput } from './birthDate'

export interface SalonBoardParsedFields {
  /** 確認表示専用。brain_customers.nameへの書き込みには使わない。 */
  name:               string | null
  /** brain_customers.name_kanaへ保存する(フリガナ表示用)。 */
  nameKana:           string | null
  birthDate:          string | null // YYYY-MM-DD
  firstVisitDate:     string | null // YYYY-MM-DD
  visitCount:         number | null
  acquisitionChannel: string | null
  postcardConsent:    string | null
}

/** 「-」「―」「未設定」等、SalonBoard側の「値なし」表現を空とみなす。 */
function isEmptyValue(v: string): boolean {
  const trimmed = v.trim()
  return trimmed.length === 0 || trimmed === '-' || trimmed === '―' || trimmed === '−'
}

/** 指定ラベルで始まる行から、ラベル直後の値部分を取り出す(最初に見つかった行のみ)。 */
function extractLineValue(lines: string[], label: string): string | null {
  const re = new RegExp(`^${label}\\s*[:：]?\\s*(.*)$`)
  for (const line of lines) {
    const m = line.match(re)
    if (m) return m[1]
  }
  return null
}

/** "1986/05/30"等の日付文字列を含む値からYYYY-MM-DDを取り出す。 */
function extractDate(value: string | null): string | null {
  if (!value) return null
  const m = value.match(/(\d{4}\/\d{1,2}\/\d{1,2})/)
  if (!m) return null
  return parseFlexibleBirthDateInput(m[1])
}

/** "7回(サロンボード登録以前：0回)"のような値から先頭の回数だけを取り出す。 */
function extractVisitCount(value: string | null): number | null {
  if (!value) return null
  const m = value.match(/(\d+)\s*回/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function parseSalonBoardDetailText(rawText: string): SalonBoardParsedFields {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)

  const nameRaw = extractLineValue(lines, '氏名 \\(漢字\\)')
  const nameKanaRaw = extractLineValue(lines, '氏名 \\(カナ\\)')
  const birthDateRaw = extractLineValue(lines, '誕生日')
  const firstVisitRaw = extractLineValue(lines, '初回来店日')
  const visitCountRaw = extractLineValue(lines, '来店回数')
  const acquisitionRaw = extractLineValue(lines, '来店きっかけ')
  const postcardRaw = extractLineValue(lines, 'はがき送付許諾')

  return {
    name:               nameRaw && !isEmptyValue(nameRaw) ? nameRaw : null,
    nameKana:           nameKanaRaw && !isEmptyValue(nameKanaRaw) ? nameKanaRaw.trim() : null,
    birthDate:          extractDate(birthDateRaw),
    firstVisitDate:     extractDate(firstVisitRaw),
    visitCount:         extractVisitCount(visitCountRaw),
    acquisitionChannel: acquisitionRaw && !isEmptyValue(acquisitionRaw) ? acquisitionRaw.trim() : null,
    postcardConsent:    postcardRaw && !isEmptyValue(postcardRaw) ? postcardRaw.trim() : null,
  }
}

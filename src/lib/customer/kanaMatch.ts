/**
 * kanaMatch.ts — 顧客検索のひらがな・カタカナ対応(PHASE CUSTOMER-SEARCH-KANA-1・2026-09-27ユーザー承認)。
 *
 * brain_customers.name_kana はSalonBoard取込由来で全角カタカナ表記だが、検索窓には
 * ひらがな・カタカナのどちらで入力されるか分からないため、比較前に双方を全角カタカナ→
 * ひらがなへ正規化してから部分一致させる(「さいとう」でも「サイトウ」でも一致させるため)。
 * 半角カタカナ・全角/半角英数の正規化は対象外(name_kanaが全角カタカナ固定のSalonBoard
 * 取込フィールドであるため、現状のスコープでは不要)。
 */

/** 全角カタカナ(U+30A1-U+30F6)をひらがなへ変換する。それ以外の文字はそのまま返す。 */
export function toHiragana(input: string): string {
  return input.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

/** ひらがな・カタカナの表記差を無視した部分一致判定(大文字小文字も無視)。 */
export function kanaIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false
  return toHiragana(haystack.toLowerCase()).includes(toHiragana(needle.toLowerCase()))
}

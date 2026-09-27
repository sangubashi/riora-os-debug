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

/**
 * 以下2関数は/karte(KarteEntryScreen.tsx)専用の姓フリガナ前方一致対応
 * (PERF-KARTE-KANA-SURNAME-1・2026-09-27ユーザー承認)。kanaIncludes()・
 * toHiragana()は他画面(CustomersScreen.tsx等)が引き続き使うため無変更のまま、
 * 追加の関数として新設する。
 */

/** 入力文字列がひらがな・カタカナ(ー含む)のみで構成されているかを判定する(半角カタカナは対象外)。 */
export function isKanaOnly(input: string): boolean {
  return /^[぀-ゟ゠-ヿ]+$/.test(input)
}

/** name_kana(「姓 名」形式・半角スペース区切り)から姓の読みだけを取り出す。スペースが無ければ全体を姓とみなす。 */
function surnameKana(nameKana: string): string {
  const spaceIdx = nameKana.indexOf(' ')
  return spaceIdx === -1 ? nameKana : nameKana.slice(0, spaceIdx)
}

/** 姓フリガナへの前方一致判定(ひらがな・カタカナ正規化込み)。名(下の名前)のフリガナは対象にしない。 */
export function kanaSurnameStartsWith(nameKana: string | null | undefined, query: string): boolean {
  if (!nameKana) return false
  const surname = toHiragana(surnameKana(nameKana).toLowerCase())
  return surname.startsWith(toHiragana(query.toLowerCase()))
}

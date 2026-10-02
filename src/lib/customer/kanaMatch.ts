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

// ================================================================
// 顧客検索の強化(2026-10-02ユーザー指示): ひらがな/カタカナ変換 + 部分一致 + 姓名またぎ
//
// 例: 「しもつり」「シモツリ」「しもつ りえ」で「下津 里恵(シモツ リエ)」様がヒットする。
// 比較の前に、双方を 小文字化 → カタカナをひらがなへ → 空白(半角・全角)を除去 で正規化するため、
// 姓と名の間の空白に関係なく「姓の末尾+名の先頭」のような入力にも一致する。
// ================================================================

/** 空白(半角・全角・タブ等)をすべて取り除く。 */
export function stripSpaces(input: string): string {
  return input.replace(/[\s　]+/g, '')
}

/** 検索用の正規化: 小文字化 → カタカナ→ひらがな → 空白除去。 */
export function normalizeForSearch(input: string): string {
  return stripSpaces(toHiragana(input.toLowerCase()))
}

/**
 * 顧客名検索の一致順位。一致しなければ null、先頭一致なら 0、途中一致なら 1。
 *  - 入力がひらがな・カタカナのみ: フリガナ(name_kana)だけを見る(漢字表記の名前に含まれる偶然の
 *    ひらがなへの誤ヒットを避ける。2026-09-27の方針を維持)。フリガナ未登録の顧客のみ、名前を見る。
 *  - それ以外(漢字等): 名前(name)を、空白を無視して部分一致で見る(「下津里」→「下津 里恵」)。
 */
export function customerNameMatchRank(
  name: string, nameKana: string | null | undefined, query: string,
): 0 | 1 | null {
  const q = normalizeForSearch(query)
  if (!q) return null
  const kana = nameKana ? normalizeForSearch(nameKana) : ''
  const target = isKanaOnly(stripSpaces(query))
    ? (kana || normalizeForSearch(name))
    : normalizeForSearch(name)
  const idx = target.indexOf(q)
  if (idx === -1) return null
  return idx === 0 ? 0 : 1
}

/** 顧客名検索に一致するか(部分一致・ひらがな/カタカナ差と空白を無視)。 */
export function customerNameMatches(name: string, nameKana: string | null | undefined, query: string): boolean {
  return customerNameMatchRank(name, nameKana, query) !== null
}

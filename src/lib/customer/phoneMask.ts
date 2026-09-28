/**
 * phoneMask.ts — 電話番号の中央マスキング(2026-09-28ユーザー承認)。
 *
 * `/karte`検索結果一覧の同姓同名識別表示専用(PII_MINIMUM_POLICY_V1では電話番号は
 * 非保持方針だが、`brain_customers.phone_number`は2026-09-24に個別例外化済み・表示は
 * PIN保護スタッフモードに限定する方針だった)。今回、中4桁を伏せ字にした表示に限り
 * 「実質的なPII露出に当たらない」というユーザー判断のもと、PIN保護前の検索結果一覧
 * への表示例外を追加承認した。この関数はその表示にのみ使う想定。
 */

/** "09012345678" → "090-※※※※-5678"。先頭・末尾4桁は残し、中間のみ同じ桁数を伏せ字にする。 */
export function maskPhoneNumberMiddle(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return null

  const last4 = digits.slice(-4)
  const first = digits.slice(0, digits.length - 8)
  const middleLen = digits.length - first.length - 4
  return `${first}-${'※'.repeat(middleLen)}-${last4}`
}

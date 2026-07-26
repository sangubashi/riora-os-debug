/**
 * staffOrder.ts — 管理者ダッシュボードのスタッフ表示順を固定する(ユーザー指示・2026-07-26)。
 * 売上順・ID順ではなく、常に鈴木→亀山→外舘→久保田(久保田は最後固定)の順で表示する。
 * この順序に無いスタッフ(将来の新規スタッフ等)は末尾へ追加する。
 */
const FIXED_STAFF_ORDER = ['鈴木', '亀山', '外舘', '久保田']

function staffOrderIndex(name: string): number {
  const idx = FIXED_STAFF_ORDER.indexOf(name)
  return idx === -1 ? FIXED_STAFF_ORDER.length : idx
}

/** 指定順序(鈴木→亀山→外舘→久保田)でソートした新しい配列を返す。 */
export function sortByFixedStaffOrder<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => staffOrderIndex(a.name) - staffOrderIndex(b.name))
}

/** staffNameを直接比較するcomparator版(itemがnameプロパティを持たない場合用)。 */
export function compareStaffOrder(nameA: string, nameB: string): number {
  return staffOrderIndex(nameA) - staffOrderIndex(nameB)
}

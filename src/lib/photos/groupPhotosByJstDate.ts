/**
 * groupPhotosByJstDate.ts — お客様カルテ「過去の写真」用: 写真を撮影日(JST)単位にグルーピングする純粋関数。
 *
 * - 撮影日は taken_at のみを使う(created_at・visit_date は使わない)。
 * - 日付は JST(+09:00固定。日本は夏時間なし)の暦日。UTC文字列の先頭10文字は使わない
 *   (JST 0:00〜8:59 の写真が前日扱いになるため)。
 * - 1枚ずつ独立して残す(同日同角度の複数枚も統合・代表写真化・削除しない)。
 * - 日付は新しい順、各日の写真は 角度順 → 同角度内は撮影時刻の古い順。
 * DOM/Reactに非依存。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 角度の表示順。ここに無い body_part(旧データ・未知の値)はこの後ろに body_part 名順で並べる。 */
export const PHOTO_ANGLE_ORDER: readonly string[] = [
  'face_front',
  'face_right',
  'face_left',
  'forehead',
]

export interface DatedPhoto {
  id: string
  bodyPart: string
  takenAt: string
}

export interface PhotoDateGroup<T extends DatedPhoto> {
  /** JST暦日 "YYYY-MM-DD"。 */
  dateKey: string
  photos: T[]
}

/** taken_at(ISO文字列)をJSTの "YYYY-MM-DD" へ。解釈できない値は null。 */
export function toJstDateKey(takenAt: string): string | null {
  const t = new Date(takenAt).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** taken_at をJSTの "HH:mm" へ。解釈できない値は空文字。 */
export function formatJstTime(takenAt: string): string {
  const t = new Date(takenAt).getTime()
  if (Number.isNaN(t)) return ''
  return new Date(t + JST_OFFSET_MS).toISOString().slice(11, 16)
}

/**
 * 日付チップの表示 "10/2"。currentYear(JST)と年が違う場合のみ "2025/10/2" と年を付ける。
 */
export function formatDateChipLabel(dateKey: string, currentYear?: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  return currentYear != null && y !== currentYear ? `${y}/${m}/${d}` : `${m}/${d}`
}

/** 現在のJST年。 */
export function currentJstYear(now: number = Date.now()): number {
  return new Date(now + JST_OFFSET_MS).getUTCFullYear()
}

function angleRank(bodyPart: string): number {
  const i = PHOTO_ANGLE_ORDER.indexOf(bodyPart)
  return i === -1 ? PHOTO_ANGLE_ORDER.length : i
}

function compareInDay(a: DatedPhoto, b: DatedPhoto): number {
  const ra = angleRank(a.bodyPart)
  const rb = angleRank(b.bodyPart)
  if (ra !== rb) return ra - rb
  // 順位が同じ(同角度、または旧データ・未知同士)は body_part 名で並べ、同一body_part内は撮影時刻の古い順。
  if (a.bodyPart !== b.bodyPart) return a.bodyPart < b.bodyPart ? -1 : 1
  const ta = new Date(a.takenAt).getTime()
  const tb = new Date(b.takenAt).getTime()
  if (ta !== tb) return ta - tb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 撮影日(JST)ごとにまとめる。日付が解釈できない写真は返り値に含めない(呼び出し元で扱う想定)。 */
export function groupPhotosByJstDate<T extends DatedPhoto>(photos: T[]): PhotoDateGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const p of photos) {
    const key = toJstDateKey(p.takenAt)
    if (!key) continue
    const bucket = map.get(key)
    if (bucket) bucket.push(p)
    else map.set(key, [p])
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)) // 新しい日付が先
    .map(([dateKey, list]) => ({ dateKey, photos: [...list].sort(compareInDay) }))
}

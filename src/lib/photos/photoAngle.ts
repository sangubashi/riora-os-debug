/**
 * photoAngle.ts — 写真カルテ 比較画面用の「アングル」語彙と撮影日グルーピング(純粋関数)。
 *
 * アングルの実体は既存の brain_customer_photos.body_part(face_front/face_right/face_left/
 * forehead)をそのまま使う。別カラムに二重管理すると同期ずれが起きるため、'front'|'right'|
 * 'left'|'forehead'|'other' はここで body_part から導出する正規化ビューとして扱う
 * (DB側の同名generated columnはレビュー用マイグレーションで用意、アプリは依存しない)。
 *
 * 過去のレガシー値(face_left45/face_right45/cheek_left等)は、bodyParts.tsの方針どおり
 * 新語彙へ再解釈せず 'other' に寄せる。
 */
import type { TimelinePhoto } from './photoApiClient'
import { toJstDateStr } from '@/lib/facialSchema/facialSchemaSelection'

export type PhotoAngle = 'front' | 'right' | 'left' | 'forehead' | 'other'

/** サムネイル一覧・並び順の基準(正面→右→左→額→その他)。 */
export const PHOTO_ANGLES: ReadonlyArray<{ id: PhotoAngle; label: string; bodyPart: string }> = [
  { id: 'front',    label: '正面',   bodyPart: 'face_front' },
  { id: 'right',    label: '右斜め', bodyPart: 'face_right' },
  { id: 'left',     label: '左斜め', bodyPart: 'face_left' },
  { id: 'forehead', label: '額',     bodyPart: 'forehead' },
  { id: 'other',    label: 'その他', bodyPart: 'other' },
]

const BODY_PART_TO_ANGLE: Record<string, PhotoAngle> = {
  face_front: 'front',
  face_right: 'right',
  face_left:  'left',
  forehead:   'forehead',
}

export function angleOfBodyPart(bodyPart: string): PhotoAngle {
  return BODY_PART_TO_ANGLE[bodyPart] ?? 'other'
}

export function isPhotoAngle(v: unknown): v is PhotoAngle {
  return typeof v === 'string' && PHOTO_ANGLES.some(a => a.id === v)
}

export function bodyPartOfAngle(angle: PhotoAngle): string {
  return PHOTO_ANGLES.find(a => a.id === angle)!.bodyPart
}

export function angleLabel(angle: PhotoAngle): string {
  return PHOTO_ANGLES.find(a => a.id === angle)!.label
}

export function angleLabelOfPhoto(photo: Pick<TimelinePhoto, 'bodyPart'>): string {
  return angleLabel(angleOfBodyPart(photo.bodyPart))
}

function angleRank(angle: PhotoAngle): number {
  return PHOTO_ANGLES.findIndex(a => a.id === angle)
}

/** 撮影日(JST暦日、YYYY-MM-DD)。 */
export function photoDayKey(photo: Pick<TimelinePhoto, 'takenAt'>): string {
  const d = new Date(photo.takenAt)
  return Number.isNaN(d.getTime()) ? photo.takenAt.slice(0, 10) : toJstDateStr(d)
}

export interface PhotoDay {
  dayKey: string
  count: number
}

/** 撮影日の一覧(新しい日が先頭)。 */
export function listPhotoDays(photos: TimelinePhoto[]): PhotoDay[] {
  const counts = new Map<string, number>()
  for (const p of photos) {
    const k = photoDayKey(p)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([dayKey, count]) => ({ dayKey, count }))
    .sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0))
}

/**
 * 指定日の写真をアングル順(正面→右→左→額→その他)に並べる。
 * 同アングルの複数枚は撮影が新しい順(同日複数枚も個別に選べるよう間引かない)。
 */
export function listPhotosOfDay(photos: TimelinePhoto[], dayKey: string): TimelinePhoto[] {
  return photos
    .filter(p => photoDayKey(p) === dayKey)
    .sort((a, b) => {
      const r = angleRank(angleOfBodyPart(a.bodyPart)) - angleRank(angleOfBodyPart(b.bodyPart))
      if (r !== 0) return r
      return a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0
    })
}

/** "2026-09-13" → "9/13"。タブ表示用。 */
export function formatDayTab(dayKey: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(dayKey)
  return m ? `${Number(m[1])}/${Number(m[2])}` : dayKey
}

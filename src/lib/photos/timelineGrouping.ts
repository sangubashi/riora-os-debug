/**
 * timelineGrouping.ts — Photo Timeline(顧客ごとの写真時系列一覧)の日付グルーピング。
 *
 * DB/APIには一切アクセスしない純粋関数として実装する(ghostSelection.tsと同じ
 * 「ロジックとI/Oの分離」方針)。UI(PhotoTimelineView.tsx)から呼び出す。
 */
import type { TimelinePhoto } from './photoApiClient'

export interface TimelineDateGroup {
  /** taken_atのUTC日付部分(YYYY-MM-DD)。グルーピングキー。 */
  dateKey: string
  photos:  TimelinePhoto[]
}

/**
 * taken_at(ISO)のUTC日付部分でグルーピングする。呼び出し元(listCustomerPhotosTimeline)は
 * 既存APIのtaken_at DESC固定順で返すため、Map挿入順を保つだけで新しい日付順が維持される。
 *
 * 既知の制約: taken_atはUTC基準で日付を切り出すため、日本時間の日付境界(UTC+9)付近で
 * 撮影・アップロードされた写真は稀に前日/翌日のグループに入ることがある(実用上は許容)。
 */
export function groupPhotosByDate(photos: TimelinePhoto[]): TimelineDateGroup[] {
  const map = new Map<string, TimelinePhoto[]>()
  for (const photo of photos) {
    const dateKey = photo.takenAt.slice(0, 10)
    const bucket = map.get(dateKey)
    if (bucket) {
      bucket.push(photo)
    } else {
      map.set(dateKey, [photo])
    }
  }
  return Array.from(map.entries()).map(([dateKey, groupPhotos]) => ({ dateKey, photos: groupPhotos }))
}

/** 'YYYY-MM-DD' → '2026年9月3日'。Dateオブジェクトを介さず文字列のまま変換しタイムゾーンずれを避ける。 */
export function formatDateLabel(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  const [, year, month, day] = match
  return `${year}年${Number(month)}月${Number(day)}日`
}

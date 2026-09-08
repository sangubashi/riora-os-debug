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

/** 写真カルテ Phase2「来店回数タイムライン」の来店タブ1件分。 */
export interface VisitTab {
  visitId:      string
  /** brain_visits.visit_count_at(来店回数)。 */
  visitCountAt: number
  visitDate:    string | null
}

/**
 * 写真からvisit_id/visitCountAtが両方揃っているものだけを対象に、来店タブの一覧を
 * visitCountAt昇順で組み立てる(写真カルテ Phase2)。
 *
 *   - visit_id/visitCountAtのいずれかがnullの写真(未紐付け写真)は対象外にする
 *     (「すべて」表示でのみ引き続き見える。過去写真の自動紐付けは行わない)。
 *   - 同一visit_idの写真は1つのタブにまとめる。
 *   - 実際に写真が紐付いているvisitCountAtの値だけを返す(欠番があっても埋めない)。
 */
export function buildVisitTabs(photos: TimelinePhoto[]): VisitTab[] {
  const map = new Map<string, VisitTab>()
  for (const photo of photos) {
    if (!photo.visitId || photo.visitCountAt === null) continue
    if (!map.has(photo.visitId)) {
      map.set(photo.visitId, {
        visitId:      photo.visitId,
        visitCountAt: photo.visitCountAt,
        visitDate:    photo.visitDate,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.visitCountAt - b.visitCountAt)
}

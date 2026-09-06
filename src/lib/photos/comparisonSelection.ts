/**
 * comparisonSelection.ts — Before/After左右比較(同一body_part内の「前回↔今回」「初回↔今回」)。
 *
 * DB/APIには一切アクセスしない純粋関数として実装する(ghostSelection.ts・timelineGrouping.ts
 * と同じ「ロジックとI/Oの分離」方針)。呼び出し元(PhotoTimelineView.tsx)が既に取得済みの
 * TimelinePhoto[](既存API taken_at DESC)をそのまま渡す前提。
 *
 * 【2026-09-06改訂: 撮影機会(occasion)単位への変更】
 * 旧実装は「同一body_part内でtaken_atが新しい順に並べ、1番目=今回・2番目=前回・
 * 最古=初回」という単純な写真単位のロジックだった。これは同一visit内の複数枚
 * (施術前の撮り直し・角度違い等)が別々の「前回」「初回」として誤選択される問題を
 * 本番データで引き起こしていた(READ ONLY調査で確認済み)。
 *
 * 新実装は、比較対象を選ぶ前に写真を「撮影機会(occasion)」単位にまとめる:
 *   - visit_idがある写真 → 同一visit_idを同一撮影機会とみなす
 *   - visit_idがnullの写真 → 同一日付(taken_atのUTC日付部分)を同一撮影機会とみなす
 * この2ルールのみを基本とし、それ以上の推測ルール(例:
 * visit_id有り写真とnull写真が同日にある場合にまとめる、等)は追加しない
 * (「visit_idがある写真とnull写真が混在する場合」の扱いは末尾のコメント参照)。
 *
 * photo_type(before/after/progress)は撮影機会の区切りには使わない(同一visit_id内の
 * before×4+after×1は依然として1つの撮影機会)。既存DB設計・既存UIの意味(3節参照)を
 * 変更する意図はなく、あくまで「どの撮影機会が前回/初回/今回か」を正しく判定するための
 * グルーピング単位の話にとどめる。
 */
import type { TimelinePhoto } from './photoApiClient'

export interface BodyPartPhotoGroup {
  bodyPart: string
  /** taken_at DESC(新しい順)。呼び出し元がAPIの既定順を維持していることが前提。 */
  photos:   TimelinePhoto[]
}

/** body_partごとにグルーピングする。入力の並び順(desc想定)をグループ内で維持する。 */
export function groupPhotosByBodyPart(photos: TimelinePhoto[]): BodyPartPhotoGroup[] {
  const map = new Map<string, TimelinePhoto[]>()
  for (const photo of photos) {
    const bucket = map.get(photo.bodyPart)
    if (bucket) {
      bucket.push(photo)
    } else {
      map.set(photo.bodyPart, [photo])
    }
  }
  return Array.from(map.entries()).map(([bodyPart, groupPhotos]) => ({ bodyPart, photos: groupPhotos }))
}

/**
 * 撮影機会を一意に識別するキー。
 * - visit_idがあれば `visit:${visitId}`
 * - visit_idがnullなら `date:${YYYY-MM-DD}`(taken_atのUTC日付部分)
 */
function occasionKey(photo: TimelinePhoto): string {
  return photo.visitId ? `visit:${photo.visitId}` : `date:${photo.takenAt.slice(0, 10)}`
}

interface PhotoOccasion {
  key:    string
  /** taken_at DESC(新しい順)。この撮影機会に属する全写真。 */
  photos: TimelinePhoto[]
}

/**
 * body_part内の写真を撮影機会単位にグルーピングする。
 * 入力(desc順)を維持したまま走査するため、各撮影機会が最初に現れる位置は
 * その撮影機会内で最も新しい写真の位置と一致する。Mapは挿入順を保持するため、
 * 返り値の配列も「最新の撮影機会が先頭」の順になる(追加のソート処理は不要)。
 */
function groupByOccasion(photos: TimelinePhoto[]): PhotoOccasion[] {
  const map = new Map<string, TimelinePhoto[]>()
  for (const photo of photos) {
    const key = occasionKey(photo)
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(photo)
    } else {
      map.set(key, [photo])
    }
  }
  return Array.from(map.entries()).map(([key, occasionPhotos]) => ({ key, photos: occasionPhotos }))
}

/** 撮影機会の代表写真(その機会内でtaken_atが最も新しい1枚)。 */
function representativePhoto(occasion: PhotoOccasion): TimelinePhoto {
  return occasion.photos[0]
}

/**
 * 比較に使える最低条件(同一body_partに撮影機会が2つ以上)を満たすグループのみ残す。
 * 同一撮影機会内に何枚写真があっても1つの撮影機会としてしか数えない
 * (例: 同日3枚だけの顧客はここで除外される。テスト3参照)。
 */
export function comparableGroups(groups: BodyPartPhotoGroup[]): BodyPartPhotoGroup[] {
  return groups.filter(g => groupByOccasion(g.photos).length >= 2)
}

/**
 * 「初回↔今回」を「前回↔今回」とは別に表示する意味があるか(=撮影機会が3つ以上あるか)。
 * 撮影機会がちょうど2つの場合、初回と前回は同じ撮影機会になるため、UI側で重複ボタンを
 * 出さないための判定に使う(PhotoTimelineView.tsx参照)。
 */
export function hasDistinctFirstOccasion(group: BodyPartPhotoGroup): boolean {
  return groupByOccasion(group.photos).length > 2
}

export type ComparisonBasis = 'previous' | 'first'

export interface ComparisonPair {
  bodyPart:  string
  /** 今回(最新の撮影機会の代表写真)。 */
  current:   TimelinePhoto
  /** 前回 or 初回(basisで区別)の撮影機会の代表写真。 */
  reference: TimelinePhoto
  basis:     ComparisonBasis
}

/**
 * 「前回↔今回」を組み立てる。呼び出し前に comparableGroups() を通し、
 * 撮影機会が2つ以上あるグループのみ渡すこと。
 * 今回 = 最新の撮影機会の代表写真、前回 = 2番目に新しい撮影機会の代表写真。
 * 同一撮影機会内の複数枚は1つにまとめられるため、同一visit/同日内の撮り直し写真が
 * 「前回」として誤って選ばれることはない。
 */
export function buildPreviousComparison(group: BodyPartPhotoGroup): ComparisonPair {
  const occasions = groupByOccasion(group.photos) // 新しい撮影機会が先頭
  return {
    bodyPart:  group.bodyPart,
    current:   representativePhoto(occasions[0]),
    reference: representativePhoto(occasions[1]),
    basis:     'previous',
  }
}

/**
 * 「初回↔今回」を組み立てる。呼び出し前に comparableGroups() を通し、
 * 撮影機会が2つ以上あるグループのみ渡すこと。
 * 今回 = 最新の撮影機会の代表写真、初回 = 最古の撮影機会の代表写真。
 * 撮影機会がちょうど2つの場合は buildPreviousComparison() と同じペアになる
 * (「前回」=「初回」として扱って問題ない)。
 */
export function buildFirstComparison(group: BodyPartPhotoGroup): ComparisonPair {
  const occasions = groupByOccasion(group.photos) // 新しい撮影機会が先頭
  const oldest = occasions[occasions.length - 1]
  return {
    bodyPart:  group.bodyPart,
    current:   representativePhoto(occasions[0]),
    reference: representativePhoto(oldest),
    basis:     'first',
  }
}

/**
 * 【未解決として報告する既知のケース】visit_idがある写真とnull写真が同日に混在する場合
 * (例: 同じ日にカメラ撮影(visit_id有り)とライブラリ追加(visit_id無し)の両方を行った場合)、
 * 現在のロジックでは `visit:${visitId}` と `date:${同じ日付}` は別キーになるため、
 * 実際には同じ来店に由来する写真であっても**別々の撮影機会として扱われる**。
 * この判定を「同日ならvisit_idの有無に関わらずまとめる」等に変更すべきかは、
 * 現在のデータ構造(TimelinePhotoにはvisit_id/taken_atのみで、null写真がどの来店に
 * 関連するかを示す情報がない)だけでは安全に判断できないため、今回は実装せず
 * 明示的に未対応のまま残す(指示通り推測で実装しない)。
 */

/**
 * comparisonSelection.ts — Before/After左右比較(同一body_part内の「前回↔今回」「初回↔今回」)。
 *
 * DB/APIには一切アクセスしない純粋関数として実装する(ghostSelection.ts・timelineGrouping.ts
 * と同じ「ロジックとI/Oの分離」方針)。呼び出し元(PhotoTimelineView.tsx)が既に取得済みの
 * TimelinePhoto[](既存API taken_at DESC)をそのまま渡す前提。
 *
 * ghostSelection.tsとの違い: あちらは「これから撮る新しい写真」の参照(ゴースト)探しであり
 * currentVisitIdの除外等が入る。こちらは「既に存在する写真同士」を並べるだけなので、単純に
 * 同一body_part内でtaken_at最新=今回、2番目に新しい=前回、最古=初回として扱う。
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

/** 比較に使える最低枚数(同一部位2枚以上)を満たすグループのみ残す。 */
export function comparableGroups(groups: BodyPartPhotoGroup[]): BodyPartPhotoGroup[] {
  return groups.filter(g => g.photos.length >= 2)
}

export type ComparisonBasis = 'previous' | 'first'

export interface ComparisonPair {
  bodyPart:  string
  /** 今回(同一body_partでtaken_atが最新の1枚)。 */
  current:   TimelinePhoto
  /** 前回 or 初回(basisで区別)。 */
  reference: TimelinePhoto
  basis:     ComparisonBasis
}

/**
 * 「前回↔今回」を組み立てる。呼び出し前に comparableGroups() を通し、
 * group.photos.length >= 2 を満たすグループのみ渡すこと。
 */
export function buildPreviousComparison(group: BodyPartPhotoGroup): ComparisonPair {
  return { bodyPart: group.bodyPart, current: group.photos[0], reference: group.photos[1], basis: 'previous' }
}

/**
 * 「初回↔今回」を組み立てる。呼び出し前に comparableGroups() を通し、
 * group.photos.length >= 2 を満たすグループのみ渡すこと。ちょうど2枚の場合は
 * buildPreviousComparison() と同じペアになる(「前回」=「初回」として扱って問題ない)。
 */
export function buildFirstComparison(group: BodyPartPhotoGroup): ComparisonPair {
  const oldest = group.photos[group.photos.length - 1]
  return { bodyPart: group.bodyPart, current: group.photos[0], reference: oldest, basis: 'first' }
}

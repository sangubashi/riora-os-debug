/**
 * comparePairSelection.ts — 写真カルテ Before/After比較UI(スライダー画面)の
 * 初期ペア選定・日付候補一覧の純粋関数群。
 *
 * DB/APIには一切アクセスしない(comparisonSelection.ts・ghostSelection.tsと同じ方針)。
 * 撮影機会単位のグルーピング・ペア組み立て自体はcomparisonSelection.tsの既存ロジックを
 * そのまま使い、ここでは「どの部位を初期表示するか」「日付選択リスト用にどう整形するか」
 * のみを追加する。
 */
import type { TimelinePhoto } from './photoApiClient'
import {
  groupPhotosByBodyPart,
  comparableGroups,
  groupByOccasion,
  representativePhoto,
  buildPreviousComparison,
  type ComparisonPair,
  type BodyPartPhotoGroup,
} from './comparisonSelection'

export interface OccasionOption {
  key: string
  photo: TimelinePhoto
}

/**
 * 初期表示ペアを選ぶ。
 * - preferredBodyPart(呼び出し元が見ていたタブ等)が比較可能(撮影機会2つ以上)なら、
 *   その部位の「前回↔今回」を返す(同じアングル同士を優先する要件への対応)。
 * - 指定が無い/比較不可なら、比較可能な部位の中で最新の撮影機会が最も新しいものを選ぶ
 *   (=直近の来店で撮影された部位を優先する自然なフォールバック)。
 * - 比較可能な部位が1つも無ければnull。
 */
export function pickInitialComparisonPair(
  photos: TimelinePhoto[],
  preferredBodyPart?: string | null
): ComparisonPair | null {
  const groups = comparableGroups(groupPhotosByBodyPart(photos))
  if (groups.length === 0) return null

  if (preferredBodyPart) {
    const preferred = groups.find(g => g.bodyPart === preferredBodyPart)
    if (preferred) return buildPreviousComparison(preferred)
  }

  let best: BodyPartPhotoGroup | null = null
  let bestTakenAt = ''
  for (const group of groups) {
    const latest = representativePhoto(groupByOccasion(group.photos)[0]).takenAt
    if (latest > bestTakenAt) {
      best = group
      bestTakenAt = latest
    }
  }
  return best ? buildPreviousComparison(best) : null
}

/** 比較可能な部位一覧(角度タブ切替用)。 */
export function listComparableBodyParts(photos: TimelinePhoto[]): string[] {
  return comparableGroups(groupPhotosByBodyPart(photos)).map(g => g.bodyPart)
}

/** 指定bodyPartの撮影機会一覧(新しい順)。日付選択リストの表示に使う。 */
export function listOccasionOptions(photos: TimelinePhoto[], bodyPart: string): OccasionOption[] {
  const group = groupPhotosByBodyPart(photos).find(g => g.bodyPart === bodyPart)
  if (!group) return []
  return groupByOccasion(group.photos).map(o => ({ key: o.key, photo: representativePhoto(o) }))
}

/** "2026/03/15"形式の日付と、「本日/○日前/○週間前/○ヶ月前」の相対表示を組み立てる。 */
export function formatOccasionDateLabel(takenAt: string): { dateStr: string; relative: string } {
  const d = new Date(takenAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = Number.isNaN(d.getTime()) ? takenAt : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`

  const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
  let relative: string
  if (diffDays === 0) relative = '本日'
  else if (diffDays < 7) relative = `${diffDays}日前`
  else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}週間前`
  else relative = `${Math.floor(diffDays / 30)}ヶ月前`

  return { dateStr, relative }
}

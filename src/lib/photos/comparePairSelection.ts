/**
 * comparePairSelection.ts — 写真カルテ Before/After比較UI(スライダー画面)の
 * 比較候補選択・日付候補一覧の純粋関数群。
 *
 * 【2026-09-17改訂: 個別写真単位への変更(設計調査セッションで確定)】
 * 旧実装はcomparisonSelection.tsの「撮影機会(occasion)」単位のグルーピングを再利用し、
 * 同一日・visit_id無しの複数写真を1つの機会に丸め込んでいたため、同じ日に同じ部位を
 * 複数枚撮影しても比較できなかった(例: 9/17に正面を3枚撮っても1機会としてしか
 * 数えられず、比較可能な相手が無いと判定されていた)。
 *
 * 新実装は「撮影機会」という概念を使わず、**同一body_partの個別写真をそのまま比較候補**
 * とする。これにより以下がすべて自然に扱える:
 *   - 同じ日に同じアングルを複数枚撮影 → それぞれ独立した候補になる
 *   - 撮り直した写真を複数枚保存 → 同上
 *   - 過去の写真を任意の日付で登録 → taken_atさえ異なれば独立した候補になる
 *   - 同じ日の写真同士の比較 → occasionの丸め込みが無いため素直に可能
 *
 * comparisonSelection.ts(お客様モード・iPadカルテの「前回/今回」ショートカット等が
 * 引き続き依存する、撮影機会単位の丸め込みロジック)には一切依存せず、このファイルの
 * 変更が他画面に影響しないようにする(ComparisonPairの型定義のみ流用する)。
 * basisフィールドは本ファイルでは常に'previous'固定で構築する(個別写真単位では
 * 「初回」を区別する意味が薄いための割り切り。PhotoCompareScreen.tsx側もbasisを
 * 表示に使っていないことを確認済み)。
 *
 * DB/APIには一切アクセスしない純粋関数として実装する(既存方針を踏襲)。
 */
import type { TimelinePhoto } from './photoApiClient'
import type { ComparisonPair } from './comparisonSelection'

export interface PhotoOption {
  photo: TimelinePhoto
}

interface BodyPartGroup {
  bodyPart: string
  /** taken_at DESC(新しい順)。呼び出し元がAPIの既定順を維持していることが前提。 */
  photos: TimelinePhoto[]
}

/**
 * body_partごとにグルーピングする。comparisonSelection.tsのgroupPhotosByBodyPartと
 * 同じ考え方の処理だが、occasion系関数へは一切依存しないためこのファイル内に
 * 独立実装する(意図的な重複。comparisonSelection.ts側への影響を断つため)。
 */
function groupByBodyPart(photos: TimelinePhoto[]): BodyPartGroup[] {
  const map = new Map<string, TimelinePhoto[]>()
  for (const photo of photos) {
    const bucket = map.get(photo.bodyPart)
    if (bucket) bucket.push(photo)
    else map.set(photo.bodyPart, [photo])
  }
  return Array.from(map.entries()).map(([bodyPart, groupPhotos]) => ({ bodyPart, photos: groupPhotos }))
}

/** グループ内の最新2枚(taken_at DESC前提の先頭2件)を今回/前回として組み立てる。 */
function buildLatestPair(group: BodyPartGroup): ComparisonPair {
  return {
    bodyPart: group.bodyPart,
    current: group.photos[0],
    reference: group.photos[1],
    basis: 'previous',
  }
}

/**
 * 初期表示ペアを選ぶ。
 * - preferredBodyPart(呼び出し元が見ていたタブ等)に写真が2枚以上あれば、
 *   その部位の最新2枚を返す(同じアングル同士を優先する要件への対応。同日複数枚でも
 *   taken_at降順の先頭2件が選ばれるため、同日内の比較にも自然に対応する)。
 * - 指定が無い/2枚未満なら、2枚以上ある部位の中で最新の撮影が最も新しいものを選ぶ。
 * - 2枚以上ある部位が1つも無ければnull。
 */
export function pickInitialComparisonPair(
  photos: TimelinePhoto[],
  preferredBodyPart?: string | null
): ComparisonPair | null {
  const groups = groupByBodyPart(photos).filter(g => g.photos.length >= 2)
  if (groups.length === 0) return null

  if (preferredBodyPart) {
    const preferred = groups.find(g => g.bodyPart === preferredBodyPart)
    if (preferred) return buildLatestPair(preferred)
  }

  let best: BodyPartGroup | null = null
  let bestTakenAt = ''
  for (const group of groups) {
    const latest = group.photos[0].takenAt // 入力はtaken_at DESC前提
    if (latest > bestTakenAt) {
      best = group
      bestTakenAt = latest
    }
  }
  return best ? buildLatestPair(best) : null
}

/** 比較可能な部位一覧(写真が2枚以上ある部位)。角度タブ切替等での利用を想定。 */
export function listComparableBodyParts(photos: TimelinePhoto[]): string[] {
  return groupByBodyPart(photos)
    .filter(g => g.photos.length >= 2)
    .map(g => g.bodyPart)
}

/**
 * 指定bodyPartの個別写真一覧(新しい順)。日付選択リストの表示に使う。
 * 撮影機会への丸め込みを行わないため、同一日・同一visitの複数枚もすべて独立した
 * 候補として返る。
 */
export function listPhotoOptions(photos: TimelinePhoto[], bodyPart: string): PhotoOption[] {
  const group = groupByBodyPart(photos).find(g => g.bodyPart === bodyPart)
  if (!group) return []
  return group.photos.map(photo => ({ photo }))
}

export interface PhotoDateLabel {
  /** "2026/03/15"形式。 */
  dateStr: string
  /** "本日"/"○日前"/"○週間前"/"○ヶ月前"。 */
  relative: string
  /** "10:05"形式(ローカルタイムゾーン)。同日複数枚を見分けるための表示用。 */
  timeStr: string
}

/** "2026/03/15"の日付・相対表示・"10:05"の時刻を組み立てる(同日複数枚の識別に時刻を使う)。 */
export function formatPhotoDateLabel(takenAt: string): PhotoDateLabel {
  const d = new Date(takenAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const invalid = Number.isNaN(d.getTime())
  const dateStr = invalid ? takenAt : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
  const timeStr = invalid ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
  let relative: string
  if (diffDays === 0) relative = '本日'
  else if (diffDays < 7) relative = `${diffDays}日前`
  else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}週間前`
  else relative = `${Math.floor(diffDays / 30)}ヶ月前`

  return { dateStr, relative, timeStr }
}

/**
 * ピッカー表示用に、各写真候補へ一意な表示ラベルを割り当てる(「同日・同時刻の写真も
 * 個別に識別できるようにする」要件への対応)。
 * - 日付が他の候補と重複しなければ日付のみ表示する。
 * - 日付が重複する場合は時刻を併記する(同日複数枚を見分ける)。
 * - 日付・時刻まで完全に一致する場合(例: 撮影日のみ指定して登録した過去写真が
 *   複数ある場合、taken_atが正午固定などで完全一致し得る)は連番を付けて区別する。
 * 表示専用の純粋関数であり、DB/APIには一切アクセスしない。
 */
export function buildPhotoOptionLabels(options: PhotoOption[]): string[] {
  const labels = options.map(o => formatPhotoDateLabel(o.photo.takenAt))

  const dateCounts = new Map<string, number>()
  for (const l of labels) dateCounts.set(l.dateStr, (dateCounts.get(l.dateStr) ?? 0) + 1)

  const compoundCounts = new Map<string, number>()
  for (const l of labels) {
    const key = `${l.dateStr} ${l.timeStr}`
    compoundCounts.set(key, (compoundCounts.get(key) ?? 0) + 1)
  }

  const ordinalSoFar = new Map<string, number>()
  return labels.map(l => {
    const showTime = (dateCounts.get(l.dateStr) ?? 0) > 1
    const compoundKey = `${l.dateStr} ${l.timeStr}`
    const isExactCollision = showTime && (compoundCounts.get(compoundKey) ?? 0) > 1

    let suffix = ''
    if (isExactCollision) {
      const n = (ordinalSoFar.get(compoundKey) ?? 0) + 1
      ordinalSoFar.set(compoundKey, n)
      suffix = ` #${n}`
    }

    const base = showTime ? `${l.dateStr} ${l.timeStr}` : l.dateStr
    return `${base}${suffix}（${l.relative}）`
  })
}

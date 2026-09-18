/**
 * ghostSelection.ts — ゴースト(前回写真)取得の優先順位ロジック
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 4節、および実装前レビューで確定した
 *   After撮影の優先順位(1: 同一visitのBefore、2: 前回visit、3: 初回、4: なし)。
 *
 * DB/APIには一切アクセスしない純粋関数として実装し、PhotoListFetcher(取得の抽象化)を
 * 呼び出し側から注入する(src/lib/voice/voiceMemoFlow.ts と同じ「ロジックとI/Oの分離」方針)。
 * 実際のHTTP実装は src/lib/photos/photoApiClient.ts の createPhotoListFetcher() が担う。
 *
 * 【2026-09-18改訂: 「撮影機会(occasion)」単位への変更(ゴースト機能の根本原因調査対応)】
 * 旧実装は「同一visit_id+photo_typeの重複排除」+「currentVisitIdとの一致除外」という
 * visit_idのみに依存したロジックだったが、iPadスタッフカルテでは撮影時点でbrain_visits
 * (来店記録)がまだ存在しない(CSV取込または接客ログ保存でしか作られず、いずれも施術後に
 * 発生するため)ケースが常態であり、その間に保存される写真のvisit_idは全てnullになる
 * (src/lib/photos/linkPhotosToVisit.ts が前提としている既知の状態)。
 *
 * 旧実装はvisit_idがnullの写真を`${visitId ?? 'none'}:${photoType}`という単一キーに
 * まとめて重複排除していたため、visit_id無しの写真が(実際の来店日を問わず)常に直近1枚
 * しか残らず、かつcurrentVisitIdがnullの間は除外自体が一切効かなかった(`if (!currentVisitId)
 * return photos`)。結果、施術中に2枚目を撮ると、数分前に撮った1枚目が「前回」として
 * 誤って選ばれてしまっていた。
 *
 * 同じ「同一visit内の複数枚が別々の前回・初回として誤選択される」問題は
 * src/lib/photos/comparisonSelection.ts(2026-09-06)で一度発見・修正済みであり、
 * その「撮影機会(occasion)」の定義(visit_idがあれば`visit:${id}`、無ければ撮影日
 * `date:${YYYY-MM-DD}`をキーにする)をこちらにも同じ考え方で適用する。
 */

export type PhotoType = 'before' | 'after' | 'progress'

export interface GhostCandidatePhoto {
  id:          string
  visitId:     string | null
  bodyPart:    string
  photoType:   PhotoType
  storagePath: string
  takenAt:     string
}

/** ゴーストが「前回」「初回」「同一visitのBefore」のいずれを根拠に選ばれたか。 */
export type GhostBasis = 'same_visit_before' | 'previous' | 'first'

export interface GhostPhotoResult {
  photo: GhostCandidatePhoto
  basis: GhostBasis
}

export interface ListPhotosParams {
  customerId: string
  bodyPart:   string
  visitId?:   string
  photoType?: PhotoType
  order?:     'asc' | 'desc'
  limit?:     number
}

export interface PhotoListFetcher {
  /** GET /api/customers/[id]/photos 相当。order省略時はdesc(既存APIの既定動作)。 */
  listPhotos(params: ListPhotosParams): Promise<GhostCandidatePhoto[]>
}

export interface GhostSelectionParams {
  customerId:     string
  bodyPart:       string
  /** 現在撮影中の来店。同一visitの写真をうっかり「前回」として拾わないための除外に使う。 */
  currentVisitId: string | null
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 撮影機会を一意に識別するキー(comparisonSelection.tsのoccasionKey()と同じ定義)。
 * - visit_idがあれば `visit:${visitId}`
 * - visit_idがnullなら `date:${YYYY-MM-DD}`(taken_atのUTC日付部分)
 */
function occasionKey(photo: GhostCandidatePhoto): string {
  return photo.visitId ? `visit:${photo.visitId}` : `date:${photo.takenAt.slice(0, 10)}`
}

/**
 * 「現在撮影中」の撮影機会キー。currentVisitId(今日のvisit)が既に存在すればそれを使い、
 * まだ存在しない(brain_visitsが未作成)場合は今日の日付を「今日の撮影機会」とみなす。
 * これによりvisit_id未確定のままでも、同日内で数分前に撮った写真を「前回」として
 * 誤って拾わないようにする。
 */
function currentOccasionKey(currentVisitId: string | null): string {
  return currentVisitId ? `visit:${currentVisitId}` : `date:${todayDateStr()}`
}

/**
 * 現在撮影中の撮影機会(同一visit、またはvisit_id未確定なら同日)の写真を候補から除外する。
 * selectGhostForBefore/After専用ではなく、useGhostOverlay.tsの日付手動選択リストからも
 * 同じ関数を使う(「今日を除外する」ロジックを1箇所に統一するため。2026-09-18改訂)。
 */
export function excludingCurrentOccasion(
  photos: GhostCandidatePhoto[],
  currentVisitId: string | null
): GhostCandidatePhoto[] {
  const currentKey = currentOccasionKey(currentVisitId)
  return photos.filter(p => occasionKey(p) !== currentKey)
}

/**
 * 同一撮影機会(同一visit_id、またはvisit_id無しなら同一日付)の写真が複数残っていた場合、
 * 各撮影機会につき先頭(入力順で最初に現れたもの)の1枚だけを代表として残す。
 * docs/PHOTO_KARTE_UX_WIREFRAME_1.md 3-5節「防御ルール」に対応。
 * 入力がdesc順なら各撮影機会の最新1枚、asc順なら最古1枚が代表として残る。
 */
function representativePerOccasion(photos: GhostCandidatePhoto[]): GhostCandidatePhoto[] {
  const seen = new Set<string>()
  const result: GhostCandidatePhoto[] = []
  for (const p of photos) {
    const key = occasionKey(p)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(p)
  }
  return result
}

/**
 * Before撮影のゴースト優先順位:
 *   1. 前回(同一body_part、photo_type問わず、taken_at最新)
 *   2. なければ初回(同一body_part、taken_at最古。GET /photos?order=asc を利用)
 *   3. なければゴーストなし(null)
 */
export async function selectGhostForBefore(
  fetcher: PhotoListFetcher,
  params:  GhostSelectionParams
): Promise<GhostPhotoResult | null> {
  const { customerId, bodyPart, currentVisitId } = params

  const recentRaw = await fetcher.listPhotos({ customerId, bodyPart, order: 'desc', limit: 5 })
  const recent = representativePerOccasion(excludingCurrentOccasion(recentRaw, currentVisitId))
  if (recent[0]) return { photo: recent[0], basis: 'previous' }

  const oldestRaw = await fetcher.listPhotos({ customerId, bodyPart, order: 'asc', limit: 5 })
  const oldest = representativePerOccasion(excludingCurrentOccasion(oldestRaw, currentVisitId))
  if (oldest[0]) return { photo: oldest[0], basis: 'first' }

  return null
}

/**
 * After撮影のゴースト優先順位:
 *   1. 同一visit_id + 同一body_part の Before(最優先。今日の施術前との位置合わせ)
 *   2. なければ前回visitの同一body_part(photo_type問わず)
 *   3. なければ初回の同一body_part
 *   4. なければゴーストなし
 */
export async function selectGhostForAfter(
  fetcher: PhotoListFetcher,
  params:  GhostSelectionParams
): Promise<GhostPhotoResult | null> {
  const { customerId, bodyPart, currentVisitId } = params

  if (currentVisitId) {
    const sameVisitBefore = await fetcher.listPhotos({
      customerId, bodyPart, visitId: currentVisitId, photoType: 'before', order: 'desc', limit: 1,
    })
    if (sameVisitBefore[0]) return { photo: sameVisitBefore[0], basis: 'same_visit_before' }
  }

  // 2〜4: Beforeと同じ「前回→初回→なし」ロジックにフォールバック
  return selectGhostForBefore(fetcher, params)
}

/**
 * ghostSelection.ts — ゴースト(前回写真)取得の優先順位ロジック
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 4節、および実装前レビューで確定した
 *   After撮影の優先順位(1: 同一visitのBefore、2: 前回visit、3: 初回、4: なし)。
 *
 * DB/APIには一切アクセスしない純粋関数として実装し、PhotoListFetcher(取得の抽象化)を
 * 呼び出し側から注入する(src/lib/voice/voiceMemoFlow.ts と同じ「ロジックとI/Oの分離」方針)。
 * 実際のHTTP実装は src/lib/photos/photoApiClient.ts の createPhotoListFetcher() が担う。
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

/**
 * 同一visit_id+body_part+photo_typeの写真が(異常系で)複数残っていた場合の防御的重複排除。
 * docs/PHOTO_KARTE_UX_WIREFRAME_1.md 3-5節「防御ルール」に対応。
 * 通常運用では効かない(重複が無い)保険であり、常に適用してよい。
 */
function dedupeByVisitAndType(photos: GhostCandidatePhoto[]): GhostCandidatePhoto[] {
  const seen = new Set<string>()
  const result: GhostCandidatePhoto[] = []
  for (const p of photos) {
    const key = `${p.visitId ?? 'none'}:${p.photoType}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(p)
  }
  return result
}

function excludingCurrentVisit(
  photos: GhostCandidatePhoto[],
  currentVisitId: string | null
): GhostCandidatePhoto[] {
  if (!currentVisitId) return photos
  return photos.filter(p => p.visitId !== currentVisitId)
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
  const recent = excludingCurrentVisit(dedupeByVisitAndType(recentRaw), currentVisitId)
  if (recent[0]) return { photo: recent[0], basis: 'previous' }

  const oldestRaw = await fetcher.listPhotos({ customerId, bodyPart, order: 'asc', limit: 5 })
  const oldest = excludingCurrentVisit(dedupeByVisitAndType(oldestRaw), currentVisitId)
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

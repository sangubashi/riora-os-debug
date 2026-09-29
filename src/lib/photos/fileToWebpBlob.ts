'use client'
/**
 * fileToWebpBlob.ts — ファイル選択フォールバック(1-10節)で選ばれた画像をWebP/JPEGへ変換する
 *
 * サーバーAPI(POST /api/customers/[id]/photos)は image/webp・image/jpeg のみ許可するため
 * (src/lib/photos/constants.ts の ALLOWED_PHOTO_MIME_TYPES)、ネイティブカメラ経由で
 * 選ばれたHEIC等もライブ撮影(captureFrame.ts)と同じくcanvas経由で変換してから送る。
 *
 * 実装前レビュー(必須修正3・4、およびiPhone実機テストでのWebP非対応判明後の改訂)対応:
 * ライブ撮影(captureFrame.ts)と同じcomputeResizedDimensions(長辺上限。Phase 3-Aで
 * 1920→3072pxへ引き上げ済み、captureFrame.tsの値をそのまま参照するためここでの追従は
 * 不要)・encodeCanvasWithFallback(WebP→JPEGの実エンコード結果判定フォールバック)を
 * 共有し、ファイル選択経由の写真でも同じ縮小・変換ルールを適用する。
 *
 * 写真撮影画質改善 Phase 3-A 取りこぼし是正(小宮山様の写真画質差調査・2026-09-20
 * ユーザー承認): 本関数はencodeCanvasWithFallbackへquality引数を明示的に渡すため、
 * Phase 3-Aでencode CanvasWithFallback側のデフォルト品質を0.8→0.9へ引き上げても
 * 本関数のデフォルト値(独自の0.8)に上書きされ、ファイル選択経由の写真だけ品質改善が
 * 適用されていなかった。ライブ撮影経路と揃えて0.9へ変更する。
 *
 * ブラウザのImage/canvas.toBlobに依存するためjsdomでは実行できず、
 * 本モジュールはユニットテスト対象外(実機確認が必要な事項として報告する)。
 */
import {
  computeResizedDimensions,
  encodeCanvasWithFallback,
  MAX_CAPTURE_LONG_EDGE_PX,
  MAX_THUMBNAIL_LONG_EDGE_PX,
  THUMBNAIL_ENCODE_QUALITY,
  type CaptureCanvas,
} from './captureFrame'

/** canvas.toBlob()をPromise化するアダプタ(captureFrame.tsのCanvasToBlobFn互換)。 */
function canvasToBlobAdapter(c: CaptureCanvas, mimeType: string, q?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    (c as unknown as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas_to_blob_failed'))),
      mimeType,
      q
    )
  })
}

/**
 * FileをHTMLImageElementへデコードする(HEIC/HEIFはSafariのネイティブ<img>デコードに
 * 依存、iPad専用運用のため実害なし)。呼び出し側はfinallyでrevokeObjectURLすること。
 */
function decodeImageFile(file: File): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload  = () => resolve({ img: el, objectUrl })
    el.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image_decode_failed')) }
    el.src = objectUrl
  })
}

/** デコード済みのHTMLImageElementから、指定の長辺上限・品質でBlobを1つ生成する。 */
function encodeImageToBlob(img: HTMLImageElement, maxLongEdge: number, quality: number): Promise<Blob> {
  const { width, height } = computeResizedDimensions(img.naturalWidth, img.naturalHeight, maxLongEdge)
  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_context_unavailable')
  // 画質調査(2026-09-29ユーザー承認、captureFrame.tsと同じ対応): ブラウザ既定の
  // imageSmoothingQuality('low'相当)のまま縮小描画すると不必要に画質が劣化するため、
  // 明示的に'high'へ引き上げる。
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return encodeCanvasWithFallback(canvas as unknown as CaptureCanvas, canvasToBlobAdapter, quality)
}

export async function convertImageFileToWebpBlob(file: File, quality = 0.9): Promise<Blob> {
  const { img, objectUrl } = await decodeImageFile(file)
  try {
    return await encodeImageToBlob(img, MAX_CAPTURE_LONG_EDGE_PX, quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * 写真サムネイル機能③(2026-09-26ユーザー承認)。convertImageFileToWebpBlobと同じ
 * デコード済みHTMLImageElementを再利用し、原本(従来と全く同じ仕様)に加えて
 * 表示用の軽量サムネイル(長辺400px・quality 0.78)を追加生成する。Fileの
 * デコード(Image要素のロード)は1回のみ行い、原本用・サムネイル用で二重に
 * デコードしない。
 *
 * 原本の生成に失敗した場合はこの関数自体が例外を投げる(従来のconvertImage
 * FileToWebpBlobと同じ挙動)。サムネイルの生成にのみ失敗した場合は原本の確定を
 * 妨げないよう、ここで捕捉してthumbnail:nullを返す(最重要: 原本保存を最優先する
 * という今回の設計方針を、Storage/DB書込み前のこのクライアント側生成段階でも
 * 同様に適用する)。
 */
export async function convertImageFileToWebpBlobWithThumbnail(
  file:             File,
  quality           = 0.9,
  thumbnailQuality  = THUMBNAIL_ENCODE_QUALITY,
): Promise<{ full: Blob; thumbnail: Blob | null }> {
  const { img, objectUrl } = await decodeImageFile(file)
  try {
    const full = await encodeImageToBlob(img, MAX_CAPTURE_LONG_EDGE_PX, quality)

    let thumbnail: Blob | null = null
    try {
      thumbnail = await encodeImageToBlob(img, MAX_THUMBNAIL_LONG_EDGE_PX, thumbnailQuality)
    } catch (e) {
      console.error('[PHOTO_KARTE][thumbnail] file選択経路のサムネイル生成に失敗(非致命的、原本のみで続行):', e)
    }

    return { full, thumbnail }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

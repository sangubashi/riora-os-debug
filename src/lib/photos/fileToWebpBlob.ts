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
import { computeResizedDimensions, encodeCanvasWithFallback, type CaptureCanvas } from './captureFrame'

export async function convertImageFileToWebpBlob(file: File, quality = 0.9): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload  = () => resolve(el)
      el.onerror = () => reject(new Error('image_decode_failed'))
      el.src = objectUrl
    })

    const { width, height } = computeResizedDimensions(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas_context_unavailable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    return await encodeCanvasWithFallback(
      canvas as unknown as CaptureCanvas,
      (c, mimeType, q) => new Promise<Blob>((resolve, reject) => {
        (c as unknown as HTMLCanvasElement).toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas_to_blob_failed'))),
          mimeType,
          q
        )
      }),
      quality
    )
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

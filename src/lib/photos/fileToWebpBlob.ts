'use client'
/**
 * fileToWebpBlob.ts — ファイル選択フォールバック(1-10節)で選ばれた画像をWebPへ変換する
 *
 * サーバーAPI(POST /api/customers/[id]/photos)は image/webp 以外を415で拒否するため
 * (src/lib/photos/constants.ts の ALLOWED_PHOTO_MIME_TYPE)、ネイティブカメラ経由で
 * 選ばれたJPEG等もライブ撮影(captureFrame.ts)と同じくcanvas経由でWebP化してから送る。
 *
 * 実装前レビュー(必須修正3・4)対応: ライブ撮影(captureFrame.ts)と同じ
 * computeResizedDimensions(長辺1920px上限)・verifyWebpBlob(エンコード結果検証)を
 * 共有し、ファイル選択経由の写真(ネイティブカメラの生解像度になりがち)でも
 * 同じ縮小・検証ルールを適用する。
 *
 * ブラウザのImage/canvas.toBlob('image/webp')に依存するためjsdomでは実行できず、
 * 本モジュールはユニットテスト対象外(実機確認が必要な事項として報告する)。
 */
import { computeResizedDimensions, verifyWebpBlob } from './captureFrame'

export async function convertImageFileToWebpBlob(file: File, quality = 0.8): Promise<Blob> {
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

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas_to_blob_failed'))),
        'image/webp',
        quality
      )
    })

    return verifyWebpBlob(blob)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

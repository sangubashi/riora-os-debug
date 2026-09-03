/**
 * captureFrame.ts — カメラプレビュー(videoフレーム)のみをcanvasに描画してBlob化する
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-4節・9-4節「保存画像にゴーストを
 * 焼き込まない」という不変条件。
 *
 * このモジュールはvideoフレーム(CaptureFrameSource)以外の描画ソースを一切受け取らない
 * 関数シグネチャになっている。ゴーストレイヤー(<img>)への参照はどこにも存在しないため、
 * 「保存画像にゴーストが焼き込まれない」ことは実装の構造そのものによって保証される
 * (追加のガード処理は不要)。
 *
 * 実装前レビュー(必須修正3・4)対応:
 *   - 長辺を最大 MAX_CAPTURE_LONG_EDGE_PX(1920px) に縮小してからエンコードする
 *     (5MB API上限に対し、無制限解像度での送信を避ける)。
 *   - canvas.toBlob(...)がWebPを生成できたか(blob.type)を確認し、非対応環境
 *     (iOS Safari等が黙ってimage/png等へフォールバックする)ではimage/jpegを
 *     改めて明示的に要求してフォールバックする。UA判定ではなく実際のエンコード結果
 *     で判定するため、WebP対応環境では引き続きWebPが優先される
 *     (実機テストで判明、iPhone 11でcanvas.toBlob('image/webp')がPNG相当へ
 *     暗黙フォールバックし撮影が完了しない問題への対応)。
 */

/** 撮影画像の長辺上限(px)。これを超える場合のみ縦横比を維持して縮小する。 */
export const MAX_CAPTURE_LONG_EDGE_PX = 1920

/**
 * 長辺が maxLongEdge を超える場合のみ、縦横比を維持して縮小した寸法を返す。
 * 超えていない場合は元の寸法をそのまま返す(無駄な拡大はしない)。
 */
export function computeResizedDimensions(
  width: number,
  height: number,
  maxLongEdge: number = MAX_CAPTURE_LONG_EDGE_PX
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height }
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) return { width, height }

  const scale = maxLongEdge / longEdge
  return {
    width:  Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * エンコードを試す形式の優先順位。WebPを優先し、実際にエンコードできなければ
 * (=返ってきたBlobのtypeが要求どおりでなければ)JPEGへフォールバックする。
 * JPEGはSafariを含む全ブラウザでcanvas.toBlobがネイティブ対応しているため、
 * このリストの2番目が失敗することは通常ない。
 */
export const CAPTURE_MIME_FALLBACK_ORDER = ['image/webp', 'image/jpeg'] as const
export type CaptureMimeType = typeof CAPTURE_MIME_FALLBACK_ORDER[number]

export type CanvasToBlobFn = (
  canvas: CaptureCanvas,
  mimeType: string,
  quality?: number
) => Promise<Blob>

/**
 * canvasを CAPTURE_MIME_FALLBACK_ORDER の順に試し、実際にその形式でエンコードできた
 * (=返ってきたBlobのtypeが要求どおりだった)最初のBlobを返す。
 *
 * ブラウザがある形式のエンコードに非対応の場合、仕様上null(呼び出し側の
 * canvasToBlob実装がエラー化する)にはならず、既定タイプ(image/png等)へ
 * 黙ってフォールバックすることがある(iOS Safari実機で確認済み)。UA判定ではなく
 * 「実際に返ってきたBlobのtype」で判定することで、ブラウザのバージョン差異に
 * 依存せず正しく動作する。
 */
export async function encodeCanvasWithFallback(
  canvas: CaptureCanvas,
  canvasToBlob: CanvasToBlobFn,
  quality = 0.8
): Promise<Blob> {
  let lastError: unknown = null

  for (const mimeType of CAPTURE_MIME_FALLBACK_ORDER) {
    try {
      const blob = await canvasToBlob(canvas, mimeType, quality)
      if (blob.type === mimeType) return blob
      // 要求と異なる形式に黙ってフォールバックされた(例: webp要求→png返却)。
      // 次の候補(jpeg)で改めて明示的に要求し直す。
    } catch (e) {
      lastError = e
    }
  }

  throw lastError instanceof Error ? lastError : new Error('unsupported_image_encoding')
}

/** 実ブラウザでは HTMLVideoElement を渡す。width/height は縮小前(video本来)の解像度。 */
export interface CaptureFrameSource {
  element: unknown
  width:   number
  height:  number
}

export interface CaptureCanvasContext {
  drawImage(source: unknown, dx: number, dy: number, dw: number, dh: number): void
}

export interface CaptureCanvas {
  width:  number
  height: number
  getContext(type: '2d'): CaptureCanvasContext | null
}

export interface CaptureFrameDeps {
  createCanvas: () => CaptureCanvas
  /** canvas → Blob 変換。実ブラウザでは canvas.toBlob() をPromise化して渡す。 */
  canvasToBlob: CanvasToBlobFn
  quality?: number
}

export async function captureVideoFrameToBlob(
  source: CaptureFrameSource,
  deps:   CaptureFrameDeps
): Promise<Blob> {
  // 必須修正3: 長辺が1920pxを超える場合のみ縮小(video本来の解像度はsourceのまま、
  // ここではcanvasの描画先サイズだけを縮小する)。
  const { width, height } = computeResizedDimensions(source.width, source.height)

  const canvas = deps.createCanvas()
  canvas.width  = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_context_unavailable')

  // 描画対象は source.element(video)のみ。ゴーストレイヤーはこの関数の引数として
  // 一切受け取れないため、ここに描画コードを追加しない限り焼き込まれることはない。
  // 4引数drawImage(image,dx,dy,dWidth,dHeight)により、縮小後サイズへの描画と
  // リサイズを同時に行う(中間canvasは不要)。
  ctx.drawImage(source.element, 0, 0, canvas.width, canvas.height)

  // 必須修正4(改訂): WebP→JPEGの順に実際のエンコード結果で判定してフォールバックする。
  return encodeCanvasWithFallback(canvas, deps.canvasToBlob, deps.quality ?? 0.8)
}

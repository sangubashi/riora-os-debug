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
 *   - 長辺を最大 MAX_CAPTURE_LONG_EDGE_PX(1920px) に縮小してからWebP化する
 *     (5MB API上限に対し、無制限解像度での送信を避ける)。
 *   - canvas.toBlob('image/webp',...) が実際にWebPを生成できたか(blob.type)を検証し、
 *     非対応端末でPNG等へ暗黙フォールバックされた場合はここでエラーとして止める
 *     (サーバーの415を待たず、クライアント側で分かりやすく失敗させる)。
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
 * canvas.toBlob等が返したBlobが実際に期待MIMEタイプ(既定image/webp)で
 * 生成されているかを検証する。ブラウザがWebPエンコードに非対応の場合、
 * 仕様上null({@link CaptureFrameDeps.canvasToBlob}の実装側でエラー化する)ではなく
 * 既定タイプ(image/png等)へ黙ってフォールバックすることがあるため、
 * ここで明示的に弾く(415をサーバーまで送ってから知るのではなく、ここで止める)。
 */
export function verifyWebpBlob(blob: Blob, expectedMimeType = 'image/webp'): Blob {
  if (blob.type !== expectedMimeType) {
    throw new Error(`unsupported_webp_encoding:${blob.type || 'unknown'}`)
  }
  return blob
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
  canvasToBlob: (canvas: CaptureCanvas, mimeType: string, quality?: number) => Promise<Blob>
  mimeType?: string
  quality?:  number
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

  const mimeType = deps.mimeType ?? 'image/webp'
  const blob = await deps.canvasToBlob(canvas, mimeType, deps.quality ?? 0.8)

  // 必須修正4: WebPエンコードが実際に成功したかを検証(非対応端末でのPNG等への
  // 暗黙フォールバックをここで検知し、サーバーの415を待たずに止める)。
  return verifyWebpBlob(blob, mimeType)
}

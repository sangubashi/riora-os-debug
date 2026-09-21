/**
 * canvasRenderer.ts — ストローク配列(正規化座標0〜1)をCanvas 2D contextへ描画する純粋関数。
 *
 * 実DOMのCanvasRenderingContext2Dを直接importせず、必要なメソッド/プロパティのみを
 * 持つインターフェース(RenderCanvasContext)を介して受け取る(src/lib/photos/captureFrame.ts
 * のCaptureCanvas/CaptureCanvasContextと同じ「テスト時はプレーンオブジェクトのモックで
 * 差し替えられるようにする」設計)。
 *
 * スタッフ編集画面(Phase 5)・お客様閲覧画面(Phase 6)の両方が必ずこの関数を経由して
 * 描画することで、2画面の見た目が実装のズレで食い違わないようにする。
 *
 * clearRect等によるキャンバスのクリアはこのモジュールの責務としない(呼び出し側=
 * Phase 4のuseFacialSchemaCanvas.tsが、strokes配列が変わるたびにキャンバスをクリアして
 * からrenderStrokes()を呼び直す想定。Undo/クリアは配列操作のみで完結させ、このモジュールは
 * 「今の配列を描く」ことだけに専念する)。
 */
import { getCategoryStyle, type FacialSchemaCategoryStyle } from './facialSchemaCategories'
import type { Stroke, StrokePoint } from './strokeModel'

export interface RenderCanvasContext {
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void
  closePath(): void
  fill(): void
  stroke(): void
  setLineDash(segments: number[]): void
  // 実DOMのCanvasRenderingContext2Dをそのまま渡せるよう、strokeStyle/fillStyleは
  // DOM側と同じ型(string | CanvasGradient | CanvasPattern)にしておく
  // (このモジュールが実際に代入する値は常にstring)。CanvasGradient/CanvasPatternは
  // TypeScriptのDOM libに含まれるグローバル型のためimport不要。
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle:   string | CanvasGradient | CanvasPattern
  lineWidth:   number
  lineCap:     string
  lineJoin:    string
  globalAlpha: number
}

/** 描画先の実寸(px)。テンプレート画像の表示サイズと一致させる(呼び出し側の責務)。 */
export interface RenderBox {
  width:  number
  height: number
}

function toPixelPoint(point: StrokePoint, box: RenderBox): { x: number; y: number } {
  return { x: point.x * box.width, y: point.y * box.height }
}

/** ストロークの正規化線幅/点半径(strokeModel.ts参照)をpxへ変換する。テンプレート幅基準。 */
function widthToPixels(width: number, box: RenderBox): number {
  return width * box.width
}

function tracePolyline(ctx: RenderCanvasContext, points: StrokePoint[], box: RenderBox): void {
  const pixelPoints = points.map(p => toPixelPoint(p, box))
  ctx.beginPath()
  ctx.moveTo(pixelPoints[0].x, pixelPoints[0].y)
  for (let i = 1; i < pixelPoints.length; i++) {
    ctx.lineTo(pixelPoints[i].x, pixelPoints[i].y)
  }
}

/** tool='point': 先頭の1点のみを使い、塗りつぶした円としてマークを描く。 */
function drawPointStroke(ctx: RenderCanvasContext, stroke: Stroke, style: FacialSchemaCategoryStyle, box: RenderBox): void {
  const { x, y } = toPixelPoint(stroke.points[0], box)
  const radius = widthToPixels(stroke.width, box)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.fillStyle = style.color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * tool='area': フリーハンドの軌跡を、カテゴリの半透明色で太くなぞった線として描く
 * (「エリアをマーキングする」操作感を優先し、自己交差しうる自由曲線を閉多角形として
 * 塗りつぶす処理は行わない設計判断)。points が1点しかない場合は塗りつぶし円として扱う
 * (タップのみでも視覚的なフィードバックを返すため)。
 */
function drawAreaStroke(ctx: RenderCanvasContext, stroke: Stroke, style: FacialSchemaCategoryStyle, box: RenderBox): void {
  if (stroke.points.length < 2) {
    drawPointStroke(ctx, stroke, style, box)
    return
  }

  ctx.save()
  ctx.globalAlpha = style.fillOpacity ?? 1
  ctx.strokeStyle = style.color
  ctx.lineWidth = widthToPixels(stroke.width, box)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  tracePolyline(ctx, stroke.points, box)
  ctx.stroke()
  ctx.restore()
}

/** tool='line': カテゴリの線種(実線/破線)でフリーハンドの軌跡をなぞる(HIFU範囲の線引き用)。 */
function drawLineStroke(ctx: RenderCanvasContext, stroke: Stroke, style: FacialSchemaCategoryStyle, box: RenderBox): void {
  if (stroke.points.length < 2) {
    drawPointStroke(ctx, stroke, style, box)
    return
  }

  ctx.save()
  ctx.globalAlpha = 1
  ctx.strokeStyle = style.color
  ctx.lineWidth = widthToPixels(stroke.width, box)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(style.lineDash ?? [])
  tracePolyline(ctx, stroke.points, box)
  ctx.stroke()
  ctx.restore()
}

/** 1ストロークをカテゴリ定義(色・線種・ツール)に従って描画する。 */
export function renderStroke(ctx: RenderCanvasContext, stroke: Stroke, box: RenderBox): void {
  const style = getCategoryStyle(stroke.category)
  if (stroke.tool === 'point') {
    drawPointStroke(ctx, stroke, style, box)
  } else if (stroke.tool === 'area') {
    drawAreaStroke(ctx, stroke, style, box)
  } else {
    drawLineStroke(ctx, stroke, style, box)
  }
}

/** ストローク配列を入力順(=描画順)に全て描画する。 */
export function renderStrokes(ctx: RenderCanvasContext, strokes: Stroke[], box: RenderBox): void {
  for (const stroke of strokes) {
    renderStroke(ctx, stroke, box)
  }
}

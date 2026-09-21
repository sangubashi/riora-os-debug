/**
 * strokeModel.ts — 顔シェーマのストローク(1筆分の描画データ)モデルと、
 * 追加・Undo・クリア・(de)シリアライズの純粋関数。
 *
 * DB/DOM/Canvasに一切依存しない(canvasRenderer.tsが描画、useFacialSchemaCanvas.ts
 * (Phase 4)がReact/Pointer Eventsとの結合を担当する)。
 *
 * Undo/クリアはビットマップの巻き戻しではなく、strokes配列というベクターデータへの
 * 追加・削除で表現する(captureConfirmFlow.tsのセッション状態管理と同じ「配列操作で
 * 完結させ、ビットマップの差分管理は行わない」方針)。呼び出し側(Phase 4)は
 * strokes配列が変わるたびにcanvasRenderer.renderStrokes()で全ストロークを描き直す。
 */
import { isFacialSchemaCategory, type FacialSchemaCategory, type FacialSchemaTool } from './facialSchemaCategories'

/** テンプレート画像に対する正規化座標(0〜1)。実寸はcanvasRenderer.ts側でbox幅高に掛けて求める。 */
export interface StrokePoint {
  x: number
  y: number
}

export interface Stroke {
  id:       string
  category: FacialSchemaCategory
  tool:     FacialSchemaTool
  /** tool='point'は要素数1、tool='area'|'line'はフリーハンドの軌跡(2点以上)。 */
  points:   StrokePoint[]
  /** テンプレート幅に対する正規化線幅/点半径(例: 0.01 = テンプレート幅の1%)。 */
  width:    number
}

/** 現行フォーマットのバージョン。将来ストローク形式を変更する場合はこれをインクリメントし、
 *  parseStrokesData()に旧versionからの変換 or 安全な既定値へのフォールバックを追加する。 */
export const FACIAL_SCHEMA_STROKES_VERSION = 1

export interface StrokesData {
  version: number
  strokes: Stroke[]
}

export function createEmptyStrokesData(): StrokesData {
  return { version: FACIAL_SCHEMA_STROKES_VERSION, strokes: [] }
}

/** 末尾に1ストロークを追加した新しいStrokesDataを返す(元のオブジェクトは変更しない)。 */
export function addStroke(data: StrokesData, stroke: Stroke): StrokesData {
  return { ...data, strokes: [...data.strokes, stroke] }
}

/** 最後の1ストロークを取り除いた新しいStrokesDataを返す。ストロークが無い場合は元のデータをそのまま返す。 */
export function undoLastStroke(data: StrokesData): StrokesData {
  if (data.strokes.length === 0) return data
  return { ...data, strokes: data.strokes.slice(0, -1) }
}

/** 全ストロークを消去した新しいStrokesDataを返す(version番号は維持する)。 */
export function clearStrokes(data: StrokesData): StrokesData {
  if (data.strokes.length === 0) return data
  return { ...data, strokes: [] }
}

function isFinitePoint(v: unknown): v is StrokePoint {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as StrokePoint).x === 'number' && Number.isFinite((v as StrokePoint).x) &&
    typeof (v as StrokePoint).y === 'number' && Number.isFinite((v as StrokePoint).y)
  )
}

function isValidTool(v: unknown): v is FacialSchemaTool {
  return v === 'point' || v === 'area' || v === 'line'
}

/**
 * 1ストローク分のバリデーション。不正な形のストロークはnullを返す(呼び出し元が除外する)。
 * DBのjsonbから読んだ値はTypeScriptの型で保証されないため、ネットワーク越しのデータと
 * 同様に防御的に検証する(ipadKarteData.tsのtoStringList()と同じ「壊れた要素は
 * 無視して残りは活かす」方針)。
 */
function sanitizeStroke(raw: unknown): Stroke | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  if (typeof r.id !== 'string' || r.id.length === 0) return null
  if (!isFacialSchemaCategory(r.category)) return null
  if (!isValidTool(r.tool)) return null
  if (typeof r.width !== 'number' || !Number.isFinite(r.width) || r.width <= 0) return null
  if (!Array.isArray(r.points) || r.points.length === 0) return null

  const points = r.points.filter(isFinitePoint)
  if (points.length === 0) return null

  return { id: r.id, category: r.category, tool: r.tool, width: r.width, points }
}

/**
 * strokes_data(jsonb由来の未知の値)を安全にパースする。
 * - versionが現行(FACIAL_SCHEMA_STROKES_VERSION)以外、または形が不正な場合は
 *   空のStrokesDataへフォールバックする(推測での自動変換はしない。現行v1しか
 *   存在したことがないため、今回のフォールバックは「壊れたデータで画面全体を
 *   壊さない」ための保険であり、実運用でv2以降のマイグレーションが必要になった
 *   時点でこの関数に変換ロジックを追加する)。
 * - 個々のストロークが不正な場合はそのストロークだけ除外し、残りは活かす。
 */
export function parseStrokesData(raw: unknown): StrokesData {
  if (typeof raw !== 'object' || raw === null) return createEmptyStrokesData()

  const r = raw as Record<string, unknown>
  if (r.version !== FACIAL_SCHEMA_STROKES_VERSION) return createEmptyStrokesData()
  if (!Array.isArray(r.strokes)) return createEmptyStrokesData()

  const strokes = r.strokes.map(sanitizeStroke).filter((s): s is Stroke => s !== null)
  return { version: FACIAL_SCHEMA_STROKES_VERSION, strokes }
}

/**
 * facialSchemaCategories.ts — 顔シェーマ機能のカテゴリ×色×線種×ツール定義。
 *
 * DB/DOMに一切依存しない純粋な定義モジュール(faceGuide.ts・tiltGuide.tsと同じ
 * 「判定・定義ロジックはReact/DOMから切り離す」方針)。
 *
 * 保存データ(strokes_data)にはcategory値のみを保存し、色・線種はここで都度解決する
 * (src/lib/photos/bodyParts.tsのbodyPartLabel()が部位ラベルを都度解決するのと同じ
 * 思想。将来この定義を調整しても過去に保存したストロークの意味は変わらない)。
 *
 * 色・線種は実装計画(顔シェーマ機能READ ONLY設計・Phase 0、2026-09-21)で
 * 「Phase 5実装時のレビューで確定させる暫定値」と明記した値をそのまま使用する。
 */

/** HIFUの「実施/回避」は独立カテゴリではなく、線種違いで表現する(凡例を煩雑にしないため)。 */
export type FacialSchemaCategory =
  | 'acne'          // ニキビ・吹き出物
  | 'redness'       // 赤み・炎症
  | 'pores'         // 毛穴・皮脂
  | 'hifu_treated'  // HIFU照射(実施)
  | 'hifu_avoided'  // HIFU照射(回避)

export type FacialSchemaTool = 'point' | 'area' | 'line'

export interface FacialSchemaCategoryStyle {
  category:     FacialSchemaCategory
  label:        string
  tool:         FacialSchemaTool
  /** ストローク本体の色(塗り・線とも基本この色を使う)。 */
  color:        string
  /** tool='area'の塗りつぶし不透明度(0〜1)。tool='point'|'line'では未使用。 */
  fillOpacity?: number
  /** tool='line'の破線パターン(canvas setLineDash相当)。空配列=実線。tool='point'|'area'では未使用。 */
  lineDash?:    number[]
}

/**
 * カテゴリ定義の並び順がそのまま凡例(Legend)の表示順になる。
 * 表内の色・線種は暫定値(Phase 5実装時のレビューで調整前提)。
 */
export const FACIAL_SCHEMA_CATEGORIES: readonly FacialSchemaCategoryStyle[] = [
  { category: 'acne',         label: 'ニキビ・吹き出物',   tool: 'point', color: '#E53935' },
  { category: 'redness',      label: '赤み・炎症',         tool: 'area',  color: '#F48FB1', fillOpacity: 0.35 },
  { category: 'pores',        label: '毛穴・皮脂',         tool: 'area',  color: '#B08D57', fillOpacity: 0.3 },
  { category: 'hifu_treated', label: 'HIFU照射(実施)',    tool: 'line',  color: '#2979FF', lineDash: [] },
  { category: 'hifu_avoided', label: 'HIFU照射(回避)',    tool: 'line',  color: '#FF6F00', lineDash: [8, 6] },
] as const

const CATEGORY_MAP: ReadonlyMap<FacialSchemaCategory, FacialSchemaCategoryStyle> =
  new Map(FACIAL_SCHEMA_CATEGORIES.map(s => [s.category, s]))

/** 既定カテゴリ(未指定時の初期選択状態に使う)。 */
export const DEFAULT_FACIAL_SCHEMA_CATEGORY: FacialSchemaCategory = FACIAL_SCHEMA_CATEGORIES[0].category

/**
 * カテゴリからスタイル定義を解決する。未知のcategory(将来の形式変更・不正データ等)を
 * 渡された場合は例外を投げず、先頭カテゴリのスタイルへフォールバックする
 * (1フレームの描画失敗で画面全体を壊さない、faceGuide.tsの検出失敗時フォールバックと
 * 同じ「壊れたデータで機能全体を止めない」方針)。
 */
export function getCategoryStyle(category: FacialSchemaCategory): FacialSchemaCategoryStyle {
  return CATEGORY_MAP.get(category) ?? FACIAL_SCHEMA_CATEGORIES[0]
}

/** 指定した文字列が既知のカテゴリかどうかを判定する(strokeModel.tsのバリデーションで使用)。 */
export function isFacialSchemaCategory(value: unknown): value is FacialSchemaCategory {
  return typeof value === 'string' && CATEGORY_MAP.has(value as FacialSchemaCategory)
}

export interface FacialSchemaLegendEntry {
  category: FacialSchemaCategory
  label:    string
  /** 凡例スウォッチ表示用の色(現状はcolorをそのまま使うが、将来スウォッチだけ別色にする余地を残すため独立フィールドにする)。 */
  swatchColor: string
  tool:     FacialSchemaTool
}

/** 凡例(Legend)表示用のデータをカテゴリ定義順に返す。UIはこれをそのままリスト表示するだけでよい。 */
export function buildFacialSchemaLegend(): FacialSchemaLegendEntry[] {
  return FACIAL_SCHEMA_CATEGORIES.map(s => ({
    category:    s.category,
    label:       s.label,
    swatchColor: s.color,
    tool:        s.tool,
  }))
}

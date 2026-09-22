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
 * 【2026-09-22改訂: タブ(意味付きカテゴリ)廃止→原色パレット化】
 * Phase 5実装時点(2026-09-21)は「ニキビ/赤み/毛穴/HIFU実施/HIFU回避」という
 * 5つの意味付きカテゴリ制だったが、現場から「タブは不要、色鉛筆のように原色から
 * 直接色を選んでメモを書きたい」との要望を受け、UIで選べる色をFACIAL_SCHEMA_COLOR_PALETTE
 * (8色、tool='area'の自由線)へ置き換えた。過去に保存済みのストローク(旧5カテゴリ)は
 * 引き続きisFacialSchemaCategory/getCategoryStyleで正しく解決できるよう、型定義・
 * CATEGORY_MAPからは削除していない(読み込み時にストロークが消えてしまうことを防ぐため。
 * 単にUIの選択ボタン一覧(旧LEGACY_FACIAL_SCHEMA_CATEGORIES)から外れただけで、既存データの
 * 表示・再描画には影響しない)。
 */

/** LEGACY_CATEGORIESは2026-09-22のタブ廃止より前に保存された可能性のあるストローク
 *  (ニキビ/赤み/毛穴/HIFU実施/HIFU回避)を今後も正しく描画するためだけに残す互換値。
 *  新規描画のUI選択肢には出さない(FACIAL_SCHEMA_COLOR_PALETTEのみを表示する)。 */
export type FacialSchemaCategory =
  | 'acne'          // (レガシー)ニキビ・吹き出物
  | 'redness'       // (レガシー)赤み・炎症
  | 'pores'         // (レガシー)毛穴・皮脂
  | 'hifu_treated'  // (レガシー)HIFU照射(実施)
  | 'hifu_avoided'  // (レガシー)HIFU照射(回避)
  | 'eraser'        // 消しゴム(2026-09-22追加、色パレットではないため凡例には出さない)
  | 'color_black' | 'color_red' | 'color_blue' | 'color_green'
  | 'color_yellow' | 'color_purple' | 'color_orange' | 'color_pink'

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
 * (レガシー互換専用。2026-09-22以降のUIには表示しない)
 * Phase 5時点の意味付き5カテゴリ。isFacialSchemaCategory/getCategoryStyleでの解決用に
 * CATEGORY_MAPへは引き続き含めるが、この配列自体はUIのボタン一覧に使わない
 * (FACIAL_SCHEMA_COLOR_PALETTEを使うこと)。
 */
export const LEGACY_FACIAL_SCHEMA_CATEGORIES: readonly FacialSchemaCategoryStyle[] = [
  { category: 'acne',         label: 'ニキビ・吹き出物',   tool: 'point', color: '#E53935' },
  { category: 'redness',      label: '赤み・炎症',         tool: 'area',  color: '#F48FB1', fillOpacity: 0.35 },
  { category: 'pores',        label: '毛穴・皮脂',         tool: 'area',  color: '#B08D57', fillOpacity: 0.3 },
  { category: 'hifu_treated', label: 'HIFU照射(実施)',    tool: 'line',  color: '#2979FF', lineDash: [] },
  { category: 'hifu_avoided', label: 'HIFU照射(回避)',    tool: 'line',  color: '#FF6F00', lineDash: [8, 6] },
] as const

/**
 * 原色カラーパレット(2026-09-22ユーザー要望: タブ廃止・色鉛筆風の原色から直接選択、
 * 黒と赤は必須)。全色tool='area'(フリーハンドの自由線、「メモを書く」用途に合わせ
 * point/lineの使い分けは廃止)・fillOpacityは指定せず既定の1(不透明、色鉛筆らしい
 * はっきりした発色)にする。UIのカテゴリ切替ボタン一覧・既定選択カテゴリはこの配列を使う。
 */
export const FACIAL_SCHEMA_COLOR_PALETTE: readonly FacialSchemaCategoryStyle[] = [
  { category: 'color_black',  label: '黒',       tool: 'area', color: '#000000' },
  { category: 'color_red',    label: '赤',       tool: 'area', color: '#E53935' },
  { category: 'color_blue',   label: '青',       tool: 'area', color: '#1E88E5' },
  { category: 'color_green',  label: '緑',       tool: 'area', color: '#43A047' },
  { category: 'color_yellow', label: '黄',       tool: 'area', color: '#FDD835' },
  { category: 'color_purple', label: '紫',       tool: 'area', color: '#8E24AA' },
  { category: 'color_orange', label: 'オレンジ', tool: 'area', color: '#FB8C00' },
  { category: 'color_pink',   label: 'ピンク',   tool: 'area', color: '#EC407A' },
] as const

/**
 * 消しゴム(2026-09-22追加)。色そのものではないため、意図的にFACIAL_SCHEMA_COLOR_PALETTE
 * (カラーパレットのボタン一覧)には含めない(FacialSchemaSection.tsx側で専用の独立した
 * ボタンとして表示する)。tool='area'なので
 * useFacialSchemaCanvas.ts側の「categoryからtoolを引く」ロジックはそのまま流用できる
 * (フック本体への変更は不要)。colorは実際の描画(canvasRenderer.tsでdestination-out
 * 合成に切り替える)では使わないが、型を満たすためのダミー値として保持する。
 */
export const ERASER_CATEGORY_STYLE: FacialSchemaCategoryStyle = {
  category: 'eraser', label: '消しゴム', tool: 'area', color: 'rgba(0,0,0,1)',
}

// レガシー5カテゴリ+新8色パレット+消しゴムの全てを解決できるようにする(過去に保存された
// ストロークがどちらの世代のものでも、isFacialSchemaCategory/getCategoryStyleで正しく
// 解決でき、描画時に消えたり先頭カテゴリへ誤フォールバックしたりしないようにするため)。
const CATEGORY_MAP: ReadonlyMap<FacialSchemaCategory, FacialSchemaCategoryStyle> =
  new Map([...LEGACY_FACIAL_SCHEMA_CATEGORIES, ...FACIAL_SCHEMA_COLOR_PALETTE, ERASER_CATEGORY_STYLE].map(s => [s.category, s]))

/** 既定カテゴリ(未指定時の初期選択状態に使う)。2026-09-22以降は原色パレットの先頭(黒)。 */
export const DEFAULT_FACIAL_SCHEMA_CATEGORY: FacialSchemaCategory = FACIAL_SCHEMA_COLOR_PALETTE[0].category

/**
 * カテゴリからスタイル定義を解決する。未知のcategory(将来の形式変更・不正データ等)を
 * 渡された場合は例外を投げず、先頭カテゴリのスタイルへフォールバックする
 * (1フレームの描画失敗で画面全体を壊さない、faceGuide.tsの検出失敗時フォールバックと
 * 同じ「壊れたデータで機能全体を止めない」方針)。
 */
export function getCategoryStyle(category: FacialSchemaCategory): FacialSchemaCategoryStyle {
  return CATEGORY_MAP.get(category) ?? FACIAL_SCHEMA_COLOR_PALETTE[0]
}

/** 指定した文字列が既知のカテゴリかどうかを判定する(strokeModel.tsのバリデーションで使用)。 */
export function isFacialSchemaCategory(value: unknown): value is FacialSchemaCategory {
  return typeof value === 'string' && CATEGORY_MAP.has(value as FacialSchemaCategory)
}

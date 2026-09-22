// ================================================================
// facialSchemaCategories.ts — カテゴリ×色×線種×ツール定義のテスト
//
// 2026-09-22改訂: タブ(意味付き5カテゴリ)廃止→原色8色パレット化。
// 旧5カテゴリはLEGACY_FACIAL_SCHEMA_CATEGORIESとして解決専用に残る(UIには出ない)。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FACIAL_SCHEMA_CATEGORY,
  ERASER_CATEGORY_STYLE,
  FACIAL_SCHEMA_COLOR_PALETTE,
  LEGACY_FACIAL_SCHEMA_CATEGORIES,
  getCategoryStyle,
  isFacialSchemaCategory,
} from '../../../src/lib/facialSchema/facialSchemaCategories'

describe('FACIAL_SCHEMA_COLOR_PALETTE', () => {
  it('原色8色を持ち、黒と赤を含む', () => {
    const categories = FACIAL_SCHEMA_COLOR_PALETTE.map(c => c.category)
    expect(categories).toHaveLength(8)
    expect(categories).toContain('color_black')
    expect(categories).toContain('color_red')
  })

  it('全色がtool=areaを持つ(色鉛筆のような自由線描画、point/lineの意味分けは廃止)', () => {
    expect(FACIAL_SCHEMA_COLOR_PALETTE.every(c => c.tool === 'area')).toBe(true)
  })

  it('全色が一意なcolorを持つ(見分けがつくこと)', () => {
    const colors = FACIAL_SCHEMA_COLOR_PALETTE.map(c => c.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('不透明(fillOpacity未指定=既定1)で、旧カテゴリのような半透明塗りではない', () => {
    expect(FACIAL_SCHEMA_COLOR_PALETTE.every(c => c.fillOpacity === undefined)).toBe(true)
  })
})

describe('LEGACY_FACIAL_SCHEMA_CATEGORIES(互換専用、UIのボタン一覧には使わない)', () => {
  it('旧仕様の5カテゴリ(ニキビ・赤み・毛穴・HIFU実施・HIFU回避)を保持する', () => {
    expect(LEGACY_FACIAL_SCHEMA_CATEGORIES.map(c => c.category)).toEqual([
      'acne', 'redness', 'pores', 'hifu_treated', 'hifu_avoided',
    ])
  })

  it('過去に保存されたストロークはgetCategoryStyleで引き続き正しく解決できる', () => {
    expect(getCategoryStyle('redness').category).toBe('redness')
    expect(getCategoryStyle('hifu_avoided').lineDash!.length).toBeGreaterThan(0)
  })
})

describe('getCategoryStyle', () => {
  it('原色パレットの既知categoryに対応するスタイルを返す', () => {
    expect(getCategoryStyle('color_red').category).toBe('color_red')
    expect(getCategoryStyle('color_red').color).toBe('#E53935')
  })

  it('未知のcategoryを渡された場合は例外を投げずパレット先頭(黒)へフォールバックする', () => {
    // @ts-expect-error 意図的に不正な値を渡す(壊れたDBデータ相当のケースを検証するため)
    const style = getCategoryStyle('unknown_category')
    expect(style).toEqual(FACIAL_SCHEMA_COLOR_PALETTE[0])
  })
})

describe('isFacialSchemaCategory', () => {
  it('原色パレット・レガシーカテゴリ・消しゴムのいずれに対してもtrueを返す', () => {
    expect(isFacialSchemaCategory('color_black')).toBe(true)
    expect(isFacialSchemaCategory('acne')).toBe(true)
    expect(isFacialSchemaCategory('eraser')).toBe(true)
  })

  it('未知の値・非文字列に対してfalseを返す', () => {
    expect(isFacialSchemaCategory('not_a_category')).toBe(false)
    expect(isFacialSchemaCategory(123)).toBe(false)
    expect(isFacialSchemaCategory(null)).toBe(false)
    expect(isFacialSchemaCategory(undefined)).toBe(false)
  })
})

describe('DEFAULT_FACIAL_SCHEMA_CATEGORY', () => {
  it('原色パレットの先頭(黒)である', () => {
    expect(DEFAULT_FACIAL_SCHEMA_CATEGORY).toBe('color_black')
    expect(isFacialSchemaCategory(DEFAULT_FACIAL_SCHEMA_CATEGORY)).toBe(true)
  })
})

describe('eraser(消しゴム)', () => {
  it('色パレットではないためFACIAL_SCHEMA_COLOR_PALETTEには含まれない', () => {
    expect(FACIAL_SCHEMA_COLOR_PALETTE.map(c => c.category)).not.toContain('eraser')
  })

  it('それでもisFacialSchemaCategory/getCategoryStyleでは有効な値として解決できる(保存/再読込のため)', () => {
    expect(isFacialSchemaCategory('eraser')).toBe(true)
    expect(getCategoryStyle('eraser')).toEqual(ERASER_CATEGORY_STYLE)
  })

  it('tool=areaを持つ(useFacialSchemaCanvas.tsのcategory→tool解決ロジックをそのまま使えるように)', () => {
    expect(ERASER_CATEGORY_STYLE.tool).toBe('area')
  })
})

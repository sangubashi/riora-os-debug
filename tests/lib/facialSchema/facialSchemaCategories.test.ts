// ================================================================
// facialSchemaCategories.ts — カテゴリ×色×線種×ツール定義のテスト
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FACIAL_SCHEMA_CATEGORY,
  FACIAL_SCHEMA_CATEGORIES,
  buildFacialSchemaLegend,
  getCategoryStyle,
  isFacialSchemaCategory,
} from '../../../src/lib/facialSchema/facialSchemaCategories'

describe('FACIAL_SCHEMA_CATEGORIES', () => {
  it('確定仕様の5カテゴリ(ニキビ・赤み・毛穴・HIFU実施・HIFU回避)を持つ', () => {
    expect(FACIAL_SCHEMA_CATEGORIES.map(c => c.category)).toEqual([
      'acne', 'redness', 'pores', 'hifu_treated', 'hifu_avoided',
    ])
  })

  it('ニキビはpoint、赤み・毛穴はarea、HIFU実施/回避はlineツールを持つ', () => {
    const byCategory = Object.fromEntries(FACIAL_SCHEMA_CATEGORIES.map(c => [c.category, c.tool]))
    expect(byCategory.acne).toBe('point')
    expect(byCategory.redness).toBe('area')
    expect(byCategory.pores).toBe('area')
    expect(byCategory.hifu_treated).toBe('line')
    expect(byCategory.hifu_avoided).toBe('line')
  })

  it('HIFU実施/回避は同系色で線種(実線/破線)のみが異なる', () => {
    const treated = getCategoryStyle('hifu_treated')
    const avoided = getCategoryStyle('hifu_avoided')
    expect(treated.lineDash).toEqual([])
    expect(avoided.lineDash).not.toEqual([])
    expect(avoided.lineDash!.length).toBeGreaterThan(0)
  })

  it('全カテゴリが一意なcolorを持つ(見分けがつくこと)', () => {
    const colors = FACIAL_SCHEMA_CATEGORIES.map(c => c.color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('getCategoryStyle', () => {
  it('既知のcategoryに対応するスタイルを返す', () => {
    expect(getCategoryStyle('redness').category).toBe('redness')
  })

  it('未知のcategoryを渡された場合は例外を投げず先頭カテゴリへフォールバックする', () => {
    // @ts-expect-error 意図的に不正な値を渡す(壊れたDBデータ相当のケースを検証するため)
    const style = getCategoryStyle('unknown_category')
    expect(style).toEqual(FACIAL_SCHEMA_CATEGORIES[0])
  })
})

describe('isFacialSchemaCategory', () => {
  it('既知のカテゴリ文字列に対してtrueを返す', () => {
    expect(isFacialSchemaCategory('acne')).toBe(true)
    expect(isFacialSchemaCategory('hifu_avoided')).toBe(true)
  })

  it('未知の値・非文字列に対してfalseを返す', () => {
    expect(isFacialSchemaCategory('not_a_category')).toBe(false)
    expect(isFacialSchemaCategory(123)).toBe(false)
    expect(isFacialSchemaCategory(null)).toBe(false)
    expect(isFacialSchemaCategory(undefined)).toBe(false)
  })
})

describe('DEFAULT_FACIAL_SCHEMA_CATEGORY', () => {
  it('既知のカテゴリの1つである', () => {
    expect(isFacialSchemaCategory(DEFAULT_FACIAL_SCHEMA_CATEGORY)).toBe(true)
  })
})

describe('buildFacialSchemaLegend', () => {
  it('カテゴリ定義と同じ順序・件数の凡例エントリを返す', () => {
    const legend = buildFacialSchemaLegend()
    expect(legend).toHaveLength(FACIAL_SCHEMA_CATEGORIES.length)
    expect(legend.map(e => e.category)).toEqual(FACIAL_SCHEMA_CATEGORIES.map(c => c.category))
  })

  it('各エントリがlabel・swatchColor・toolを持つ', () => {
    const legend = buildFacialSchemaLegend()
    for (const entry of legend) {
      expect(typeof entry.label).toBe('string')
      expect(entry.label.length).toBeGreaterThan(0)
      expect(typeof entry.swatchColor).toBe('string')
      expect(['point', 'area', 'line']).toContain(entry.tool)
    }
  })
})

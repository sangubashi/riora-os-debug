// ================================================================
// hotpepperMenuDiff 検証
//
// Hot Pepperから取得したメニュー一覧と既存brain_menusを比較する純粋関数。
// 「削除しない」(possiblyDiscontinuedとして提示するのみ)という設計上の
// 不変条件を含めて検証する。
// ================================================================
import { describe, expect, it } from 'vitest'
import { computeHotpepperMenuDiff, type ExistingMenuForDiff } from '../../../src/lib/menu/hotpepperMenuDiff'
import type { HotpepperParsedItem } from '../../../src/lib/menu/hotpepperMenuParser'

function item(overrides: Partial<HotpepperParsedItem> = {}): HotpepperParsedItem {
  return { hotpepperItemId: 'CP001', name: 'テストメニュー', price: 10000, category: 'coupon', ...overrides }
}

function existing(overrides: Partial<ExistingMenuForDiff> = {}): ExistingMenuForDiff {
  return { id: 'm1', name: 'テストメニュー', price: 10000, role: 'entry', hotpepperItemId: null, ...overrides }
}

describe('computeHotpepperMenuDiff', () => {
  it('ID一致・価格一致はnoChangeCountに数える', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP001', price: 10000 })],
      [existing({ hotpepperItemId: 'CP001', price: 10000 })],
    )
    expect(result.noChangeCount).toBe(1)
    expect(result.priceChanges).toEqual([])
    expect(result.newItems).toEqual([])
  })

  it('ID一致・価格不一致はpriceChangesに入る', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP001', price: 12000, name: '新価格メニュー' })],
      [existing({ id: 'm1', hotpepperItemId: 'CP001', price: 10000 })],
    )
    expect(result.priceChanges).toEqual([
      { menuId: 'm1', hotpepperItemId: 'CP001', name: '新価格メニュー', oldPrice: 10000, newPrice: 12000 },
    ])
    expect(result.noChangeCount).toBe(0)
  })

  it('ID未一致かつ名称一致(未追跡の既存行)はbackfillsに入る', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP999', name: 'ヒト幹細胞ベーシック人気No.1', price: 15000 })],
      [existing({ id: 'm1', name: 'ヒト幹細胞ベーシック人気No.1', price: 15000, hotpepperItemId: null })],
    )
    expect(result.backfills).toEqual([
      { menuId: 'm1', hotpepperItemId: 'CP999', name: 'ヒト幹細胞ベーシック人気No.1', priceChange: null },
    ])
    expect(result.newItems).toEqual([])
  })

  it('バックフィル対象でも価格が違えばpriceChangeを併記する', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP999', name: 'ヒト幹細胞ベーシック人気No.1', price: 16000 })],
      [existing({ id: 'm1', name: 'ヒト幹細胞ベーシック人気No.1', price: 15000, hotpepperItemId: null })],
    )
    expect(result.backfills[0].priceChange).toEqual({ oldPrice: 15000, newPrice: 16000 })
  })

  it('imported_other行は名称一致してもバックフィル対象にしない(CSV突合フォールバック専用のため)', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP999', name: '同名メニュー', price: 10000 })],
      [existing({ id: 'm1', name: '同名メニュー', role: 'imported_other', hotpepperItemId: null })],
    )
    expect(result.backfills).toEqual([])
    expect(result.newItems).toEqual([
      { hotpepperItemId: 'CP999', name: '同名メニュー', price: 10000, category: 'coupon' },
    ])
  })

  it('ID未一致・名称も一致しなければnewItemsに入る', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP999', name: '完全に新しいメニュー', price: 8000 })],
      [existing({ id: 'm1', name: '既存メニュー', hotpepperItemId: null })],
    )
    expect(result.newItems).toEqual([
      { hotpepperItemId: 'CP999', name: '完全に新しいメニュー', price: 8000, category: 'coupon' },
    ])
  })

  it('¥0の項目は新規提案せずexcludedNoPriceに入る(予約導線案内等の非施術メニュー対策)', () => {
    const result = computeHotpepperMenuDiff(
      [item({ hotpepperItemId: 'CP999', name: '【メニューに迷った方へ】ご提案します◎', price: 0 })],
      [],
    )
    expect(result.newItems).toEqual([])
    expect(result.excludedNoPrice).toEqual([
      { hotpepperItemId: 'CP999', name: '【メニューに迷った方へ】ご提案します◎', price: 0, category: 'coupon' },
    ])
  })

  it('既存がhotpepperItemIdを持つのに今回の取得結果に無ければpossiblyDiscontinuedに入る(削除はしない)', () => {
    const result = computeHotpepperMenuDiff(
      [], // 今回の取得結果は空
      [existing({ id: 'm1', hotpepperItemId: 'CP001', name: '掲載終了したメニュー', price: 9000 })],
    )
    expect(result.possiblyDiscontinued).toEqual([
      { menuId: 'm1', name: '掲載終了したメニュー', price: 9000, hotpepperItemId: 'CP001' },
    ])
  })

  it('hotpepperItemIdを持たない既存行は、今回の結果に無くてもpossiblyDiscontinuedに入らない(未追跡の手動登録メニューのため)', () => {
    const result = computeHotpepperMenuDiff(
      [],
      [existing({ id: 'm1', hotpepperItemId: null, name: '手動登録メニュー' })],
    )
    expect(result.possiblyDiscontinued).toEqual([])
  })
})

/**
 * hotpepperMenuDiff.ts — 取得済みHot Pepperメニューと現在のbrain_menusを比較する純粋関数
 *
 * 「削除」は行わない(このプロジェクトの一貫した方針: 過去データは推測で消さない)。
 * Hot Pepper上に見当たらなくなった既存メニューは"possiblyDiscontinued"として提示するのみ。
 */
import type { HotpepperParsedItem } from './hotpepperMenuParser'

/** 差分判定に必要な最小限のメニュー情報(Menu型全体を要求しない、テストしやすさのため)。 */
export interface ExistingMenuForDiff {
  id: string
  name: string
  price: number
  role: string
  hotpepperItemId: string | null
}

export interface NewMenuProposal {
  hotpepperItemId: string
  name: string
  price: number | null
  category: HotpepperParsedItem['category']
}

export interface PriceChangeProposal {
  menuId: string
  hotpepperItemId: string
  name: string
  oldPrice: number
  newPrice: number
}

export interface BackfillProposal {
  menuId: string
  hotpepperItemId: string
  name: string
  /** 名称一致で紐付けと同時に価格も変わる場合のみ設定(変わらなければnull)。 */
  priceChange: { oldPrice: number; newPrice: number } | null
}

export interface PossiblyDiscontinuedMenu {
  menuId: string
  name: string
  price: number
  hotpepperItemId: string
}

export interface HotpepperMenuDiffResult {
  newItems: NewMenuProposal[]
  priceChanges: PriceChangeProposal[]
  backfills: BackfillProposal[]
  possiblyDiscontinued: PossiblyDiscontinuedMenu[]
  /**
   * ¥0または価格不明のためnewItemsから除外した項目(参考表示用、未追跡のまま)。
   * 実データ検証(2026-09-22)の結果、¥0の項目は一貫して「メニュー相談」「予約導線案内」
   * 等の施術実体を持たないクーポンだったため、新規メニューとして提案しない。
   */
  excludedNoPrice: NewMenuProposal[]
  /** 変化なし件数(ID一致・価格一致)。参考表示用。 */
  noChangeCount: number
}

export function computeHotpepperMenuDiff(
  parsedItems: HotpepperParsedItem[],
  existingMenus: ExistingMenuForDiff[],
): HotpepperMenuDiffResult {
  const byId = new Map(
    existingMenus.filter(m => m.hotpepperItemId).map(m => [m.hotpepperItemId as string, m]),
  )
  // 未追跡(hotpepperItemId未設定)の手動登録メニューは、名称完全一致でのバックフィル対象。
  // imported_other(CSV突合フォールバック専用)は対象外(役割判定の意味を持たないため)。
  const unlinkedByName = new Map(
    existingMenus
      .filter(m => !m.hotpepperItemId && m.role !== 'imported_other')
      .map(m => [m.name, m]),
  )

  const newItems: NewMenuProposal[] = []
  const excludedNoPrice: NewMenuProposal[] = []
  const priceChanges: PriceChangeProposal[] = []
  const backfills: BackfillProposal[] = []
  let noChangeCount = 0

  const parsedIds = new Set<string>()

  for (const item of parsedItems) {
    parsedIds.add(item.hotpepperItemId)

    const linked = byId.get(item.hotpepperItemId)
    if (linked) {
      if (item.price !== null && item.price !== linked.price) {
        priceChanges.push({
          menuId: linked.id,
          hotpepperItemId: item.hotpepperItemId,
          name: item.name,
          oldPrice: linked.price,
          newPrice: item.price,
        })
      } else {
        noChangeCount++
      }
      continue
    }

    const unlinked = unlinkedByName.get(item.name)
    if (unlinked) {
      const priceChange = item.price !== null && item.price !== unlinked.price
        ? { oldPrice: unlinked.price, newPrice: item.price }
        : null
      backfills.push({
        menuId: unlinked.id,
        hotpepperItemId: item.hotpepperItemId,
        name: item.name,
        priceChange,
      })
      continue
    }

    const proposal: NewMenuProposal = {
      hotpepperItemId: item.hotpepperItemId,
      name: item.name,
      price: item.price,
      category: item.category,
    }
    // ¥0または価格不明の項目は「メニュー相談」「予約導線案内」等、施術実体を持たない
    // クーポンである可能性が高いため(2026-09-22実データ検証で確認済み)、新規メニュー
    // としては提案しない(除外リストに載せるのみ、自動登録もしない)。
    if (!item.price) {
      excludedNoPrice.push(proposal)
    } else {
      newItems.push(proposal)
    }
  }

  const possiblyDiscontinued: PossiblyDiscontinuedMenu[] = existingMenus
    .filter(m => m.hotpepperItemId && !parsedIds.has(m.hotpepperItemId))
    .map(m => ({ menuId: m.id, name: m.name, price: m.price, hotpepperItemId: m.hotpepperItemId as string }))

  return { newItems, priceChanges, backfills, possiblyDiscontinued, excludedNoPrice, noChangeCount }
}

/**
 * runHotpepperMenuSync.ts — Hot Pepper Beauty自動取込のオーケストレーション
 *
 * 設計はsrc/lib/import/runMenuReclassification.tsと同じdryRunパターンを踏襲する
 * (dryRun:trueは常にDB書き込みなし、falseの場合のみ実際にbrain_menusへ反映する)。
 *
 * 新規メニューの登録値(2026-09-22ユーザー承認): role='entry'(分類エンジンへ影響しない
 * 安全な既定値)・target_types=[](空="未分類"の印。Menu Master画面でバッジ表示し、
 * 担当者が後から手動でrole/target_typesを設定する運用)。
 */
import { fetchAllHotPepperItems, type FetchTextFn } from './hotpepperMenuFetcher'
import { computeHotpepperMenuDiff, type ExistingMenuForDiff, type HotpepperMenuDiffResult } from './hotpepperMenuDiff'
import type { Menu, UUID } from '../../types/riora.types'

export interface HotpepperSyncMenuRepo {
  listByStore(storeId: UUID): Promise<Menu[]>
  create(input: {
    storeId: UUID; name: string; price: number; role: 'entry'; targetTypes: []
    hotpepperItemId: string; hotpepperSyncedAt: string
  }): Promise<Menu>
  update(id: UUID, input: {
    price?: number; hotpepperItemId?: string; hotpepperSyncedAt?: string
  }): Promise<Menu | null>
}

export interface RunHotpepperMenuSyncInput {
  storeId: UUID
  sourceUrl: string
  dryRun: boolean
  fetchText?: FetchTextFn
}

export interface HotpepperSyncReport extends HotpepperMenuDiffResult {
  dryRun: boolean
  fetchedAt: string
  pagesFetched: number
  totalParsedItems: number
  /** dryRun:falseの場合に実際に書き込んだ件数(新規作成+価格更新+バックフィル)。 */
  appliedCount: number
}

function toExistingMenuForDiff(m: Menu): ExistingMenuForDiff {
  return { id: m.id, name: m.name, price: m.price, role: m.role, hotpepperItemId: m.hotpepperItemId ?? null }
}

export async function runHotpepperMenuSync(
  input: RunHotpepperMenuSyncInput,
  menuRepo: HotpepperSyncMenuRepo,
): Promise<HotpepperSyncReport> {
  const fetched = await fetchAllHotPepperItems(input.sourceUrl, input.fetchText)
  const allParsedItems = [...fetched.coupons, ...fetched.menuOptions]

  const existingMenus = await menuRepo.listByStore(input.storeId)
  const diff = computeHotpepperMenuDiff(allParsedItems, existingMenus.map(toExistingMenuForDiff))

  const fetchedAt = new Date().toISOString()
  let appliedCount = 0

  if (!input.dryRun) {
    for (const item of diff.newItems) {
      if (item.price === null) continue // 価格が読み取れなかった項目は自動登録しない(人の確認に委ねる)
      await menuRepo.create({
        storeId: input.storeId,
        name: item.name,
        price: item.price,
        role: 'entry',
        targetTypes: [],
        hotpepperItemId: item.hotpepperItemId,
        hotpepperSyncedAt: fetchedAt,
      })
      appliedCount++
    }

    for (const change of diff.priceChanges) {
      await menuRepo.update(change.menuId, { price: change.newPrice, hotpepperSyncedAt: fetchedAt })
      appliedCount++
    }

    for (const backfill of diff.backfills) {
      await menuRepo.update(backfill.menuId, {
        hotpepperItemId: backfill.hotpepperItemId,
        hotpepperSyncedAt: fetchedAt,
        ...(backfill.priceChange ? { price: backfill.priceChange.newPrice } : {}),
      })
      appliedCount++
    }
  }

  return {
    ...diff,
    dryRun: input.dryRun,
    fetchedAt,
    pagesFetched: fetched.pagesFetched,
    totalParsedItems: allParsedItems.length,
    appliedCount,
  }
}

// ================================================================
// runHotpepperMenuSync 検証
//
// dryRun:trueは常にDB書き込み無し(runMenuReclassification.tsと同じ契約)、
// dryRun:falseで実際に新規作成・価格更新・バックフィルが行われることを、
// インメモリのフェイクmenuRepoで検証する。
// ================================================================
import { describe, expect, it } from 'vitest'
import { runHotpepperMenuSync, type HotpepperSyncMenuRepo } from '../../../src/lib/menu/runHotpepperMenuSync'
import type { Menu } from '../../../src/types/riora.types'

function fakeMenu(overrides: Partial<Menu> = {}): Menu {
  return {
    id: 'm-existing', storeId: 'store-1', name: '既存メニュー', price: 10000,
    role: 'entry', targetTypes: [], hotpepperItemId: null, hotpepperSyncedAt: null,
    ...overrides,
  }
}

function createFakeRepo(initial: Menu[]): HotpepperSyncMenuRepo & { menus: Menu[] } {
  const menus = [...initial]
  let nextId = 1
  return {
    menus,
    async listByStore() {
      return menus
    },
    async create(input) {
      const menu: Menu = {
        id: `new-${nextId++}`,
        storeId: input.storeId,
        name: input.name,
        price: input.price,
        role: input.role,
        targetTypes: input.targetTypes,
        hotpepperItemId: input.hotpepperItemId,
        hotpepperSyncedAt: input.hotpepperSyncedAt,
      }
      menus.push(menu)
      return menu
    },
    async update(id, input) {
      const target = menus.find(m => m.id === id)
      if (!target) return null
      if (input.price !== undefined) target.price = input.price
      if (input.hotpepperItemId !== undefined) target.hotpepperItemId = input.hotpepperItemId
      if (input.hotpepperSyncedAt !== undefined) target.hotpepperSyncedAt = input.hotpepperSyncedAt
      return target
    },
  }
}

const HTML_ONE_NEW_COUPON = `
<a id="CP00000000000099" name="CP00000000000099"><!-- --></a><div><p class="couponMenuPrice">¥8,000</p><p class="couponMenuName fs14">新規クーポン</p></div>
`

describe('runHotpepperMenuSync', () => {
  it('dryRun:trueではDBへ一切書き込まない', async () => {
    const repo = createFakeRepo([])
    const beforeCount = repo.menus.length

    const report = await runHotpepperMenuSync(
      { storeId: 'store-1', sourceUrl: 'https://example.com/coupon/', dryRun: true, fetchText: async () => HTML_ONE_NEW_COUPON },
      repo,
    )

    expect(report.dryRun).toBe(true)
    expect(report.newItems).toHaveLength(1)
    expect(report.appliedCount).toBe(0)
    expect(repo.menus).toHaveLength(beforeCount) // 書き込み無し
  })

  it('dryRun:falseで新規メニューをrole=entry・target_types=[]で作成する(未分類マーカー)', async () => {
    const repo = createFakeRepo([])

    const report = await runHotpepperMenuSync(
      { storeId: 'store-1', sourceUrl: 'https://example.com/coupon/', dryRun: false, fetchText: async () => HTML_ONE_NEW_COUPON },
      repo,
    )

    expect(report.appliedCount).toBe(1)
    expect(repo.menus).toHaveLength(1)
    expect(repo.menus[0]).toMatchObject({
      name: '新規クーポン', price: 8000, role: 'entry', targetTypes: [], hotpepperItemId: 'CP00000000000099',
    })
  })

  it('価格変更をdryRun:falseで実際に反映する', async () => {
    const repo = createFakeRepo([fakeMenu({ id: 'm1', hotpepperItemId: 'CP00000000000099', price: 5000 })])

    const report = await runHotpepperMenuSync(
      { storeId: 'store-1', sourceUrl: 'https://example.com/coupon/', dryRun: false, fetchText: async () => HTML_ONE_NEW_COUPON },
      repo,
    )

    expect(report.priceChanges).toHaveLength(1)
    expect(report.newItems).toHaveLength(0)
    expect(repo.menus.find(m => m.id === 'm1')?.price).toBe(8000)
  })

  it('価格が読み取れなかった新規項目はexcludedNoPriceへ回り、自動登録しない', async () => {
    const html = `<a id="CP00000000000001" name="CP00000000000001"><!-- --></a><div><p class="couponMenuPrice">価格未定</p><p class="couponMenuName fs14">価格不明クーポン</p></div>`
    const repo = createFakeRepo([])

    const report = await runHotpepperMenuSync(
      { storeId: 'store-1', sourceUrl: 'https://example.com/coupon/', dryRun: false, fetchText: async () => html },
      repo,
    )

    expect(report.newItems).toHaveLength(0)
    expect(report.excludedNoPrice).toHaveLength(1) // プレビューには出す(除外リストとして)
    expect(report.appliedCount).toBe(0) // 書き込みはしない
    expect(repo.menus).toHaveLength(0)
  })

  it('¥0のコース(予約導線案内等)は自動登録の候補から外れる', async () => {
    const html = `<a id="CP00000000000002" name="CP00000000000002"><!-- --></a><div><p class="couponMenuPrice">¥0</p><p class="couponMenuName fs14">【メニューに迷った方へ】ご提案します◎</p></div>`
    const repo = createFakeRepo([])

    const report = await runHotpepperMenuSync(
      { storeId: 'store-1', sourceUrl: 'https://example.com/coupon/', dryRun: false, fetchText: async () => html },
      repo,
    )

    expect(report.newItems).toHaveLength(0)
    expect(report.excludedNoPrice).toHaveLength(1)
    expect(report.appliedCount).toBe(0)
    expect(repo.menus).toHaveLength(0)
  })
})

// ================================================================
// hotpepperMenuFetcher 検証
//
// 「次のN件」リンクを実ネットワークアクセス無しに辿れること、循環URLで
// 無限ループしない安全弁を検証する(fetchTextをモック注入)。
// ================================================================
import { describe, expect, it } from 'vitest'
import { fetchAllHotPepperItems } from '../../../src/lib/menu/hotpepperMenuFetcher'

const page1 = `
<a id="CP00000000000001" name="CP00000000000001"><!-- --></a><div><p class="couponMenuPrice">¥1,000</p><p class="couponMenuName fs14">ページ1クーポン</p></div>
<a href="https://example.com/coupon/PN2.html"><span class="iS arrowPagingR">次の25件</span></a>
`
const page2 = `
<a id="CP00000000000002" name="CP00000000000002"><!-- --></a><div><p class="couponMenuPrice">¥2,000</p><p class="couponMenuName fs14">ページ2クーポン</p></div>
`

describe('fetchAllHotPepperItems', () => {
  it('次ページリンクを辿って全ページのクーポンを結合する', async () => {
    const fetchText = async (url: string) => {
      if (url === 'https://example.com/coupon/') return page1
      if (url === 'https://example.com/coupon/PN2.html') return page2
      throw new Error(`unexpected url: ${url}`)
    }

    const result = await fetchAllHotPepperItems('https://example.com/coupon/', fetchText)
    expect(result.pagesFetched).toBe(2)
    expect(result.coupons.map(c => c.hotpepperItemId)).toEqual(['CP00000000000001', 'CP00000000000002'])
  })

  it('同一URLへ循環するページ送りでも無限ループしない', async () => {
    const fetchText = async () => `
      <a id="CP00000000000001" name="CP00000000000001"><!-- --></a><div><p class="couponMenuPrice">¥1,000</p><p class="couponMenuName fs14">循環クーポン</p></div>
      <a href="https://example.com/coupon/"><span class="iS arrowPagingR">次の25件</span></a>
    `
    const result = await fetchAllHotPepperItems('https://example.com/coupon/', fetchText)
    expect(result.pagesFetched).toBe(1) // 同一URLは2回目でvisitedUrlsに引っかかり停止する
  })
})

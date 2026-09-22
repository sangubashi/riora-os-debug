// ================================================================
// hotpepperMenuParser 検証
//
// 2026-09-22の技術検証(curlで実際に取得した生HTML)で確認した実マークアップ構造を
// 元にした最小フィクスチャで、クーポン/メニュー(オプション)/ページ送りリンクの
// 抽出を検証する。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  parseHotPepperCoupons, parseHotPepperMenuOptions, findNextCouponPageUrl, parseHotPepperPage,
} from '../../../src/lib/menu/hotpepperMenuParser'

const COUPON_FIXTURE = `
<div id="couponList"><h2 class="mainCntSecondTtl cGray">リオラ(Riora)のクーポン</h2></div>
<a id="CP00000012652962" name="CP00000012652962"><!-- --></a><div class="mT10"><table><tbody><tr><td class="couponLabelCT02">新<br />規</td><td class="bgWhite p12 vaT w554"><div class="couponMenuHeadWrap"><div><ul class="couponMenuIcons"><li>フェイシャル</li></ul></div><p class="couponMenuPrice">¥0</p></div><div class="mT8 b"><p class="couponMenuName fs14">【メニューに迷った方へ】お悩みやご予算に合わせてメニューをご提案します◎</p></div></td></tr></tbody></table></div>
<a id="CP00000013098669" name="CP00000013098669"><!-- --></a><div class="mT10"><table><tbody><tr><td class="couponLabelCT02">新<br />規</td><td class="bgWhite p12 vaT w554"><div class="couponMenuHeadWrap"><div><ul class="couponMenuIcons"><li>フェイシャル</li></ul></div><p class="couponMenuPrice">¥12,000</p></div><div class="mT8 b"><p class="couponMenuName fs14">【土日祝限定】ヒト幹細胞ベーシック★敏感肌◎ニキビケア◎ ￥15000→￥12000</p></div></td></tr></tbody></table></div>
<a id="CP00000099999999" name="CP00000099999999"><!-- --></a><div class="mT10"><table><tbody><tr><td class="couponLabelCT02">新<br />規</td><td class="bgWhite p12 vaT w554"><div class="couponMenuHeadWrap"><div><ul class="couponMenuIcons"><li>フェイシャル</li></ul></div><p class="couponMenuPrice">¥19,800</p></div><div class="mT8 b"><p class="couponMenuName fs14">ハーブピーリング &amp; 幹細胞導入上級</p></div></td></tr></tbody></table></div>
<ul class="paging jscPagingParents"><li><span class="current">1</span></li><li><a href="https://beauty.hotpepper.jp/kr/slnH000808958/coupon/PN2.html">2</a></li><li class="pa top0 right0 afterPage"><a href="https://beauty.hotpepper.jp/kr/slnH000808958/coupon/PN2.html"><span class="iS arrowPagingR">次の25件</span></a></li></ul>
`

const MENU_OPTION_FIXTURE = `
<div class="mT30"><div><h2 class="mainCntSecondTtl cGray">リオラ(Riora)のメニュー</h2></div><div><div class="mT20"><div class="singleMenuHead mT20 cFix b"><p class="b fl"><span>フェイシャル</span></p></div><table class="mT10 menuTbl">
<tr><td class="bgWhite"><div class="pT10 pB10 pL10 pR15"><div class="b cFix"><p class="fl couponMenuName fs14 w423 mR10">オプション：スクライバー</p><p class="oh wwbw taR fs16 fgGray">¥2,200</p></div></div></td><td class="bgLLGray2 vaM w170 pV10"><div><a href="https://beauty.hotpepper.jp/CSP/kr/reserve/?storeId=H000808958&amp;menuId=MN00000013602375&amp;add=5" class="btn">空席確認・予約する</a></div><div class="mT10 taC"><a href="https://beauty.hotpepper.jp/CSP/kr/reserve/?storeId=H000808958&amp;menuId=MN00000013602375&amp;add=6" class="fs11 b">メニューを追加して予約する</a></div></td></tr>
<tr><td class="bgWhite"><div class="pT10 pB10 pL10 pR15"><div class="b cFix"><p class="fl couponMenuName fs14 w423 mR10">オプション：ハイドラフェイシャル 1部位</p><p class="oh wwbw taR fs16 fgGray">¥3,300</p></div></div></td><td class="bgLLGray2 vaM w170 pV10"><div><a href="https://beauty.hotpepper.jp/CSP/kr/reserve/?storeId=H000808958&amp;menuId=MN00000013602376&amp;add=5" class="btn">空席確認・予約する</a></div><div class="mT10 taC"><a href="https://beauty.hotpepper.jp/CSP/kr/reserve/?storeId=H000808958&amp;menuId=MN00000013602376&amp;add=6" class="fs11 b">メニューを追加して予約する</a></div></td></tr>
</table></div></div></div>
`

describe('parseHotPepperCoupons', () => {
  it('各クーポンのID・名称・価格を順序どおり抽出する', () => {
    const items = parseHotPepperCoupons(COUPON_FIXTURE)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({
      hotpepperItemId: 'CP00000012652962',
      name: '【メニューに迷った方へ】お悩みやご予算に合わせてメニューをご提案します◎',
      price: 0,
      category: 'coupon',
    })
    expect(items[1]).toEqual({
      hotpepperItemId: 'CP00000013098669',
      name: '【土日祝限定】ヒト幹細胞ベーシック★敏感肌◎ニキビケア◎ ￥15000→￥12000',
      price: 12000,
      category: 'coupon',
    })
  })

  it('HTML実体参照(&amp;等)をデコードする', () => {
    const items = parseHotPepperCoupons(COUPON_FIXTURE)
    expect(items[2].name).toBe('ハーブピーリング & 幹細胞導入上級')
    expect(items[2].price).toBe(19800)
  })

  it('couponMenuNameが見つからないブロックはスキップする(構造変化への耐性)', () => {
    const broken = `<a id="CP00000000000001" name="CP00000000000001"><!-- --></a><div>名前要素が無い壊れたブロック</div>`
    expect(parseHotPepperCoupons(broken)).toEqual([])
  })
})

describe('parseHotPepperMenuOptions', () => {
  it('各行のmenuId・名称・価格を抽出する(1行に複数のmenuIdリンクがあっても最初の1件のみ採用)', () => {
    const items = parseHotPepperMenuOptions(MENU_OPTION_FIXTURE)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      hotpepperItemId: 'MN00000013602375',
      name: 'オプション：スクライバー',
      price: 2200,
      category: 'menu_option',
    })
    expect(items[1].hotpepperItemId).toBe('MN00000013602376')
    expect(items[1].price).toBe(3300)
  })
})

describe('findNextCouponPageUrl', () => {
  it('「次のN件」リンクの絶対URLを抽出する', () => {
    expect(findNextCouponPageUrl(COUPON_FIXTURE)).toBe(
      'https://beauty.hotpepper.jp/kr/slnH000808958/coupon/PN2.html',
    )
  })

  it('次ページが無ければnullを返す', () => {
    expect(findNextCouponPageUrl('<div>ページ送りリンクなし</div>')).toBeNull()
  })
})

describe('parseHotPepperPage', () => {
  it('クーポン・メニュー・次ページURLをまとめて返す', () => {
    const result = parseHotPepperPage(COUPON_FIXTURE + MENU_OPTION_FIXTURE)
    expect(result.coupons).toHaveLength(3)
    expect(result.menuOptions).toHaveLength(2)
    expect(result.nextCouponPageUrl).toBe('https://beauty.hotpepper.jp/kr/slnH000808958/coupon/PN2.html')
  })
})

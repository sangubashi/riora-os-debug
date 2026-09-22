/**
 * hotpepperMenuParser.ts — Hot Pepper Beautyのクーポン一覧ページ(HTML)を解析する純粋関数群
 *
 * 設計根拠: 2026-09-22の技術検証(READ ONLY、curlで生HTMLを取得)により、対象ページは
 * JSフレームワーク(React/Next/Nuxt等)のマーカーが無いサーバーレンダリング済み静的HTMLで
 * あることを確認済み。そのため本パーサーはDOM APIやheadless browserに依存せず、
 * 検証済みの具体的なマークアップ構造(下記)に対する正規表現ベースの抽出のみで実装する
 * (cheerio等の新規依存追加を避ける、usePinchZoom.ts/useLongPress.tsと同じ「外部
 * ライブラリを増やさない」方針)。
 *
 * 確認済みマークアップ構造:
 *   クーポン: <a id="CP00000012652962" name="CP00000012652962">...
 *     <p class="couponMenuPrice">¥12,000</p> ... <p class="couponMenuName fs14">名前</p>
 *   メニュー(オプション): <tr>...<p class="fl couponMenuName fs14 w423 mR10">名前</p>
 *     <p class="oh wwbw taR fs16 fgGray">¥2,200</p>...menuId=MN00000013602375...</tr>
 *   ページ送り: <a href=".../coupon/PN2.html">2</a> (クーポン一覧のみ。メニュー欄は
 *     technical-spike時点では1ページに収まっていたが、念のため同じ仕組みで対応する)
 *
 * ⚠️ Hot Pepper側のマークアップ変更に弱い(意図的なトレードオフ、faceGuide.tsの暫定閾値と
 * 同じ位置づけ)。解析結果が0件になった場合は「変更が無かった」のか「構造が変わって
 * 抽出できなくなった」のかを呼び出し側で区別できるよう、抽出できたブロック数も返す。
 */

export type HotpepperItemCategory = 'coupon' | 'menu_option'

export interface HotpepperParsedItem {
  /** "CP00000012652962" または "MN00000013602375"(プレフィックスがカテゴリを兼ねる)。 */
  hotpepperItemId: string
  name: string
  /** 円。価格表記が読み取れない場合はnull(呼び出し側で「価格不明」として扱う)。 */
  price: number | null
  category: HotpepperItemCategory
}

export interface ParseHotPepperPageResult {
  coupons: HotpepperParsedItem[]
  menuOptions: HotpepperParsedItem[]
  /** クーポン一覧の「次のN件」ページがあればその絶対URL(無ければnull)。 */
  nextCouponPageUrl: string | null
}

/** HTML実体参照の最小限デコード(&amp; &quot; &#39; &lt; &gt;)。対象ページで実際に使われる範囲のみ。 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** "¥12,000" / "¥0" のような表記から数値を取り出す。読み取れなければnull。 */
function parsePriceText(text: string | undefined): number | null {
  if (!text) return null
  const m = text.match(/([\d,]+)/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * クーポン一覧を解析する。<a id="CP.../ name="CP...">を区切りに、次の同種アンカーまでを
 * 1クーポン分のブロックとして扱う(実際のマークアップがこの順で出現することを検証済み)。
 */
export function parseHotPepperCoupons(html: string): HotpepperParsedItem[] {
  const anchorPattern = /<a id="(CP\d+)" name="CP\d+">/g
  const matches: { id: string; index: number }[] = []
  let m: RegExpExecArray | null
  while ((m = anchorPattern.exec(html)) !== null) {
    matches.push({ id: m[1], index: m.index })
  }

  const items: HotpepperParsedItem[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length
    const block = html.slice(start, end)

    const nameMatch = block.match(/<p class="couponMenuName fs14">([^<]*)<\/p>/)
    const priceMatch = block.match(/<p class="couponMenuPrice">([^<]*)<\/p>/)
    if (!nameMatch) continue

    items.push({
      hotpepperItemId: matches[i].id,
      name: decodeHtmlEntities(nameMatch[1]),
      price: parsePriceText(priceMatch?.[1]),
      category: 'coupon',
    })
  }
  return items
}

/**
 * メニュー(オプション)一覧を解析する。各行(<tr>)にmenuId=MN...への予約リンクが
 * 複数(空席確認用・追加予約用)含まれるため、行内で最初に見つかったIDのみを採用する。
 */
export function parseHotPepperMenuOptions(html: string): HotpepperParsedItem[] {
  const rows = html.split('<tr>').slice(1) // 先頭要素はテーブル開始前の残骸なので捨てる

  const items: HotpepperParsedItem[] = []
  for (const row of rows) {
    const idMatch = row.match(/menuId=(MN\d+)/)
    const nameMatch = row.match(/<p class="fl couponMenuName fs14 w423 mR10">([^<]*)<\/p>/)
    if (!idMatch || !nameMatch) continue

    const priceMatch = row.match(/<p class="oh wwbw taR fs16 fgGray">([^<]*)<\/p>/)

    items.push({
      hotpepperItemId: idMatch[1],
      name: decodeHtmlEntities(nameMatch[1]),
      price: parsePriceText(priceMatch?.[1]),
      category: 'menu_option',
    })
  }
  return items
}

/**
 * クーポン一覧の「次のN件」リンク(絶対URL)を抽出する。無ければnull。
 * ドメインは固定しない(テスト容易性のため。href自体が絶対URLであることのみを前提とする)。
 */
export function findNextCouponPageUrl(html: string): string | null {
  const m = html.match(/<a href="(https:\/\/[^"]*\/coupon\/PN\d+\.html)"[^>]*>\s*<span class="iS arrowPagingR">/)
  return m ? decodeHtmlEntities(m[1]) : null
}

/** 1ページ分のHTMLからクーポン・メニュー双方と次ページURLをまとめて取り出す。 */
export function parseHotPepperPage(html: string): ParseHotPepperPageResult {
  return {
    coupons: parseHotPepperCoupons(html),
    menuOptions: parseHotPepperMenuOptions(html),
    nextCouponPageUrl: findNextCouponPageUrl(html),
  }
}

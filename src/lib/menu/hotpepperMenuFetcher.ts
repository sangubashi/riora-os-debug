/**
 * hotpepperMenuFetcher.ts — Hot Pepper Beautyページの取得(ネットワークI/O層)
 *
 * hotpepperMenuParser.tsの純粋関数を、実際のページ送りを辿りながら呼び出す。
 * fetch実装はDIできるようにし(captureFrame.tsのdeps注入と同じ方針)、テストでは
 * 固定HTMLを返すモックに差し替えられるようにする(実ネットワークアクセスはテスト対象外)。
 */
import { parseHotPepperPage, type HotpepperParsedItem } from './hotpepperMenuParser'

export type FetchTextFn = (url: string) => Promise<string>

/** 実ブラウザ/Node環境向けの既定実装。一般的なブラウザのUser-Agentを付与する
 *  (技術検証時、UA無しでも200が返ることは確認済みだが、念のため付与しておく)。 */
export const defaultFetchText: FetchTextFn = async (url: string) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.8',
    },
  })
  if (!res.ok) {
    throw new Error(`hotpepper_fetch_failed: ${res.status} ${url}`)
  }
  return res.text()
}

/** 無限ループ防止(ページ構造の想定外変化でnextCouponPageUrlが循環した場合の安全弁)。 */
const MAX_COUPON_PAGES = 10

export interface FetchAllHotPepperItemsResult {
  coupons: HotpepperParsedItem[]
  menuOptions: HotpepperParsedItem[]
  pagesFetched: number
}

/**
 * クーポン一覧の全ページを辿って取得し、メニュー(オプション)一覧(1ページ目のみに
 * 存在する想定、技術検証時点の実測どおり)と合わせて返す。
 */
export async function fetchAllHotPepperItems(
  firstPageUrl: string,
  fetchText: FetchTextFn = defaultFetchText,
): Promise<FetchAllHotPepperItemsResult> {
  const coupons: HotpepperParsedItem[] = []
  let menuOptions: HotpepperParsedItem[] = []
  const visitedUrls = new Set<string>()

  let currentUrl: string | null = firstPageUrl
  let pagesFetched = 0

  while (currentUrl && !visitedUrls.has(currentUrl) && pagesFetched < MAX_COUPON_PAGES) {
    visitedUrls.add(currentUrl)
    const html = await fetchText(currentUrl)
    const parsed = parseHotPepperPage(html)

    coupons.push(...parsed.coupons)
    // メニュー(オプション)欄はクーポンのページ送りとは無関係に1ページ目にのみ出現する
    // 想定だが、念のため出現したページの分はすべて取り込む(重複は呼び出し側で気にしなくて
    // よいよう、hotpepperItemIdで自然に重複除去されるためここでは何もしない)。
    if (parsed.menuOptions.length > 0) menuOptions = [...menuOptions, ...parsed.menuOptions]

    pagesFetched += 1
    currentUrl = parsed.nextCouponPageUrl
  }

  // hotpepperItemId基準で重複除去(万一同じページを二重に取り込んでいた場合の保険)。
  const dedupe = (items: HotpepperParsedItem[]): HotpepperParsedItem[] => {
    const seen = new Map<string, HotpepperParsedItem>()
    for (const item of items) seen.set(item.hotpepperItemId, item)
    return Array.from(seen.values())
  }

  return {
    coupons: dedupe(coupons),
    menuOptions: dedupe(menuOptions),
    pagesFetched,
  }
}

/**
 * vipAnalytics.ts  — VIP共通特徴分析
 *
 * VIP顧客だけを抽出し、共通する行動パターン・施術・商品を分析する。
 * 純粋関数。Supabase 依存なし。
 */

import type { VipProfile, VipRankItem, VipAnalyticsResult } from '@/types'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface VipAnalyticsRow {
  id:               string
  isVip:            boolean
  visits:           number
  totalSales:       number
  lineResponseRate: number
  cycleDays:        number   // 来店周期（日）
  hasRecentPurchase: boolean
  treatments:       string[]  // 利用施術リスト
  products:         string[]  // 購入商品リスト
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function avgArr(arr: number[]): number {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}

function rankByFrequency(
  items: string[][],
  total: number
): VipRankItem[] {
  const counter = new Map<string, number>()
  items.flat().forEach(name => {
    counter.set(name, (counter.get(name) ?? 0) + 1)
  })
  return Array.from(counter.entries())
    .map(([name, count]) => ({
      name,
      count,
      rate: Math.round(count / total * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

// ─── メイン集計 ───────────────────────────────────────────────────────────────

export function calcVipAnalytics(rows: VipAnalyticsRow[]): VipAnalyticsResult {
  const vips = rows.filter(r => r.isVip)

  if (vips.length === 0) {
    return {
      profile: { count:0, avgVisits:0, avgSales:0, avgLineResponse:0, avgCycleDays:0, purchaseRate:0 },
      treatmentRanking: [],
      productRanking:   [],
      insights:         ['VIP顧客データがまだありません'],
    }
  }

  // プロフィール集計
  const profile: VipProfile = {
    count:           vips.length,
    avgVisits:       avgArr(vips.map(r => r.visits)),
    avgSales:        avgArr(vips.map(r => r.totalSales)),
    avgLineResponse: avgArr(vips.map(r => r.lineResponseRate)),
    avgCycleDays:    avgArr(vips.map(r => r.cycleDays)),
    purchaseRate:    Math.round(vips.filter(r => r.hasRecentPurchase).length / vips.length * 100),
  }

  // 施術・商品ランキング
  const treatmentRanking = rankByFrequency(vips.map(r => r.treatments), vips.length)
  const productRanking   = rankByFrequency(vips.map(r => r.products),   vips.length)

  // AIインサイト生成
  const insights: string[] = []

  if (treatmentRanking.length > 0) {
    const top = treatmentRanking[0]
    insights.push(`VIP顧客の${top.rate}%が「${top.name}」を利用`)
  }
  if (treatmentRanking.length > 1) {
    const t2 = treatmentRanking[1]
    insights.push(`「${t2.name}」もVIPの${t2.rate}%が利用`)
  }
  if (productRanking.length > 0) {
    const top = productRanking[0]
    insights.push(`VIP顧客の${top.rate}%が「${top.name}」を購入`)
  }
  insights.push(`VIP顧客の平均LINE返信率は${profile.avgLineResponse}%`)
  insights.push(`VIP顧客の店販購入率は${profile.purchaseRate}%`)

  return { profile, treatmentRanking, productRanking, insights }
}

// ─── ダミーデータ ──────────────────────────────────────────────────────────────

export const DEMO_VIP_ROWS: VipAnalyticsRow[] = [
  // VIP (3名)
  { id:'c-1', isVip:true,  visits:12, totalSales:216000, lineResponseRate:75, cycleDays:28, hasRecentPurchase:true,
    treatments:['プレミアムエイジングケア','ハーブピーリング'], products:['美容液A','クリームC'] },
  { id:'c-2', isVip:true,  visits:18, totalSales:324000, lineResponseRate:82, cycleDays:25, hasRecentPurchase:true,
    treatments:['プレミアムエイジングケア','ホワイトニングケア'], products:['美容液A','化粧水B'] },
  { id:'c-3', isVip:true,  visits:14, totalSales:252000, lineResponseRate:68, cycleDays:30, hasRecentPurchase:true,
    treatments:['プレミアムエイジングケア'], products:['クリームC'] },
  // 非VIP (5名)
  { id:'c-4', isVip:false, visits:9,  totalSales:135000, lineResponseRate:55, cycleDays:32, hasRecentPurchase:false,
    treatments:['ハーブピーリング'], products:[] },
  { id:'c-5', isVip:false, visits:6,  totalSales:72000,  lineResponseRate:60, cycleDays:35, hasRecentPurchase:false,
    treatments:['モイスチャーフェイシャル'], products:['化粧水B'] },
  { id:'c-6', isVip:false, visits:4,  totalSales:48000,  lineResponseRate:40, cycleDays:38, hasRecentPurchase:false,
    treatments:['モイスチャーフェイシャル'], products:[] },
  { id:'c-7', isVip:false, visits:3,  totalSales:36000,  lineResponseRate:35, cycleDays:45, hasRecentPurchase:false,
    treatments:['ハーブピーリング'], products:[] },
  { id:'c-8', isVip:false, visits:5,  totalSales:60000,  lineResponseRate:20, cycleDays:50, hasRecentPurchase:false,
    treatments:['ホワイトニングケア'], products:[] },
]

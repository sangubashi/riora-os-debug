/**
 * productAnalytics.ts  — 成功商品分析
 *
 * 商品ごとに売上・リピート率・VIP率・次回予約率を集計。
 * 純粋関数。Supabase 依存なし。
 */

import type { ProductStats, ProductAnalyticsResult } from '@/types'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface ProductCustomerRow {
  productName:   string
  purchasePrice: number   // 購入金額
  isVip:         boolean
  hasNextRebook: boolean
  visitCount:    number   // 来店回数（3以上でリピーター判定）
  churnRisk:     number
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function avgArr(arr: number[]): number {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}

// ─── メイン集計 ───────────────────────────────────────────────────────────────

export function calcProductAnalytics(
  rows: ProductCustomerRow[]
): ProductAnalyticsResult {
  if (rows.length === 0) {
    return { products: [], salesRanking: [], vipRanking: [], rebookRanking: [], insights: [], totalBuyers: 0 }
  }

  // 商品名でグルーピング
  const map = new Map<string, ProductCustomerRow[]>()
  rows.forEach(r => {
    map.set(r.productName, [...(map.get(r.productName) ?? []), r])
  })

  const products: ProductStats[] = Array.from(map.entries()).map(([name, group]) => ({
    name,
    buyerCount:   group.length,
    totalRevenue: group.reduce((s, r) => s + r.purchasePrice, 0),
    repeatRate:   Math.round(group.filter(r => r.visitCount >= 3).length / group.length * 100),
    rebookRate:   Math.round(group.filter(r => r.hasNextRebook).length   / group.length * 100),
    vipRate:      Math.round(group.filter(r => r.isVip).length           / group.length * 100),
  }))

  // 2名以上のみランキング対象
  const rankable       = products.filter(p => p.buyerCount >= 2)
  const salesRanking   = [...rankable].sort((a,b) => b.totalRevenue - a.totalRevenue).slice(0, 5)
  const vipRanking     = [...rankable].sort((a,b) => b.vipRate      - a.vipRate).slice(0, 5)
  const rebookRanking  = [...rankable].sort((a,b) => b.rebookRate   - a.rebookRate).slice(0, 5)

  // 全商品の非購入者リピート率（比較用）
  const allRepeatRate = avgArr(rows.map(r => r.visitCount >= 3 ? 100 : 0))

  // AIインサイト生成
  const insights: string[] = []

  if (vipRanking.length > 0) {
    const top = vipRanking[0]
    insights.push(`「${top.name}」購入者のVIP率は${top.vipRate}%`)
  }

  if (salesRanking.length > 0) {
    const top = salesRanking[0]
    const perBuyer = Math.round(top.totalRevenue / top.buyerCount / 1000)
    insights.push(`「${top.name}」は${top.buyerCount}名が購入・1人あたり¥${perBuyer}千円`)
  }

  // リピート率が高い商品
  if (rankable.length > 0) {
    const topRepeat = [...rankable].sort((a,b) => b.repeatRate - a.repeatRate)[0]
    if (topRepeat.repeatRate > allRepeatRate && allRepeatRate > 0) {
      const ratio = (topRepeat.repeatRate / allRepeatRate).toFixed(1)
      insights.push(`「${topRepeat.name}」購入者はリピート率が${ratio}倍高い`)
    }
  }

  // 次回予約率トップ
  if (rebookRanking.length > 0) {
    const top = rebookRanking[0]
    insights.push(`「${top.name}」購入者の次回予約率${top.rebookRate}%`)
  }

  return {
    products, salesRanking, vipRanking, rebookRanking,
    insights,
    totalBuyers: rows.length,
  }
}

// ─── ダミーデータ ──────────────────────────────────────────────────────────────

export const DEMO_PRODUCT_ROWS: ProductCustomerRow[] = [
  // 美容液A (7名)
  { productName:'美容液A', purchasePrice:18000, isVip:true,  hasNextRebook:true,  visitCount:12, churnRisk:8  },
  { productName:'美容液A', purchasePrice:18000, isVip:true,  hasNextRebook:true,  visitCount:18, churnRisk:5  },
  { productName:'美容液A', purchasePrice:18000, isVip:true,  hasNextRebook:true,  visitCount:14, churnRisk:10 },
  { productName:'美容液A', purchasePrice:18000, isVip:false, hasNextRebook:true,  visitCount:9,  churnRisk:18 },
  { productName:'美容液A', purchasePrice:18000, isVip:false, hasNextRebook:true,  visitCount:7,  churnRisk:22 },
  { productName:'美容液A', purchasePrice:18000, isVip:false, hasNextRebook:false, visitCount:4,  churnRisk:35 },
  { productName:'美容液A', purchasePrice:18000, isVip:false, hasNextRebook:true,  visitCount:6,  churnRisk:28 },
  // 化粧水B (5名)
  { productName:'化粧水B', purchasePrice:12000, isVip:true,  hasNextRebook:true,  visitCount:10, churnRisk:12 },
  { productName:'化粧水B', purchasePrice:12000, isVip:false, hasNextRebook:true,  visitCount:6,  churnRisk:25 },
  { productName:'化粧水B', purchasePrice:12000, isVip:false, hasNextRebook:true,  visitCount:5,  churnRisk:30 },
  { productName:'化粧水B', purchasePrice:12000, isVip:false, hasNextRebook:false, visitCount:3,  churnRisk:40 },
  { productName:'化粧水B', purchasePrice:12000, isVip:false, hasNextRebook:false, visitCount:2,  churnRisk:55 },
  // クリームC (4名)
  { productName:'クリームC', purchasePrice:22000, isVip:true,  hasNextRebook:true,  visitCount:15, churnRisk:6  },
  { productName:'クリームC', purchasePrice:22000, isVip:true,  hasNextRebook:true,  visitCount:11, churnRisk:14 },
  { productName:'クリームC', purchasePrice:22000, isVip:false, hasNextRebook:true,  visitCount:8,  churnRisk:20 },
  { productName:'クリームC', purchasePrice:22000, isVip:false, hasNextRebook:false, visitCount:4,  churnRisk:38 },
  // 日焼け止めD (3名)
  { productName:'日焼け止めD', purchasePrice:8000, isVip:false, hasNextRebook:true,  visitCount:5,  churnRisk:32 },
  { productName:'日焼け止めD', purchasePrice:8000, isVip:false, hasNextRebook:false, visitCount:3,  churnRisk:45 },
  { productName:'日焼け止めD', purchasePrice:8000, isVip:false, hasNextRebook:false, visitCount:2,  churnRisk:60 },
]

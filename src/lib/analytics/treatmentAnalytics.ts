/**
 * treatmentAnalytics.ts  — 成功施術分析
 *
 * 店舗全体のデータから施術ごとのKPIを集計。
 * 純粋関数。Supabase 依存なし。
 */

import type { TreatmentStats, TreatmentAnalyticsResult } from '@/types'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface TreatmentCustomerRow {
  treatmentName:    string
  totalSales:       number
  visitCount:       number   // この施術の来店回数
  hasRecentPurchase: boolean
  hasNextRebook:    boolean  // 次回予約あり
  churnRisk:        number   // 低いほどリピート率高
}

// ─── メイン集計関数 ───────────────────────────────────────────────────────────

function avgArr(arr: number[]): number {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}

export function calcTreatmentAnalytics(
  rows: TreatmentCustomerRow[]
): TreatmentAnalyticsResult {
  if (rows.length === 0) {
    return { treatments: [], salesRanking: [], repeatRanking: [], rebookRanking: [], insights: [], totalCustomers: 0 }
  }

  // 施術名でグルーピング
  const groupMap = new Map<string, TreatmentCustomerRow[]>()
  rows.forEach(r => {
    const existing = groupMap.get(r.treatmentName) ?? []
    groupMap.set(r.treatmentName, [...existing, r])
  })

  const treatments: TreatmentStats[] = Array.from(groupMap.entries()).map(([name, group]) => ({
    name,
    customerCount: group.length,
    avgSales:      avgArr(group.map(r => r.totalSales)),
    repeatRate:    Math.round(group.filter(r => r.visitCount >= 3).length / group.length * 100),
    rebookRate:    Math.round(group.filter(r => r.hasNextRebook).length  / group.length * 100),
    purchaseRate:  Math.round(group.filter(r => r.hasRecentPurchase).length / group.length * 100),
  }))

  // ランキング（2件以上ある施術のみ）
  const ranked = treatments.filter(t => t.customerCount >= 2)
  const salesRanking  = [...ranked].sort((a,b) => b.avgSales   - a.avgSales).slice(0, 5)
  const repeatRanking = [...ranked].sort((a,b) => b.repeatRate - a.repeatRate).slice(0, 5)
  const rebookRanking = [...ranked].sort((a,b) => b.rebookRate - a.rebookRate).slice(0, 5)

  // AIインサイト生成
  const insights: string[] = []

  if (salesRanking.length > 0) {
    const top = salesRanking[0]
    insights.push(`「${top.name}」が最高平均売上 ¥${Math.round(top.avgSales/10000)}万`)
  }

  if (repeatRanking.length > 0) {
    const top = repeatRanking[0]
    insights.push(`「${top.name}」利用者のリピート率 ${top.repeatRate}%`)
  }

  // 店販購入率が高い施術
  const highPurchase = [...ranked].sort((a,b) => b.purchaseRate - a.purchaseRate)[0]
  if (highPurchase && highPurchase.purchaseRate >= 50) {
    insights.push(`「${highPurchase.name}」利用者の${highPurchase.purchaseRate}%が店販購入`)
  }

  // 次回予約率比較（最高 vs 最低）
  if (rebookRanking.length >= 2) {
    const best  = rebookRanking[0]
    const worst = rebookRanking[rebookRanking.length - 1]
    if (worst.rebookRate > 0) {
      const ratio = (best.rebookRate / worst.rebookRate).toFixed(1)
      insights.push(`「${best.name}」は次回予約率が「${worst.name}」の${ratio}倍`)
    }
  }

  return {
    treatments, salesRanking, repeatRanking, rebookRanking,
    insights,
    totalCustomers: rows.length,
  }
}

// ─── ダミーデータ ──────────────────────────────────────────────────────────────

export const DEMO_TREATMENT_ROWS: TreatmentCustomerRow[] = [
  // プレミアムエイジングケア (5名)
  { treatmentName:'プレミアムエイジングケア', totalSales:216000, visitCount:12, hasRecentPurchase:true,  hasNextRebook:true,  churnRisk:8  },
  { treatmentName:'プレミアムエイジングケア', totalSales:324000, visitCount:18, hasRecentPurchase:true,  hasNextRebook:true,  churnRisk:5  },
  { treatmentName:'プレミアムエイジングケア', totalSales:252000, visitCount:14, hasRecentPurchase:true,  hasNextRebook:true,  churnRisk:10 },
  { treatmentName:'プレミアムエイジングケア', totalSales:180000, visitCount:10, hasRecentPurchase:false, hasNextRebook:true,  churnRisk:15 },
  { treatmentName:'プレミアムエイジングケア', totalSales:144000, visitCount:8,  hasRecentPurchase:true,  hasNextRebook:false, churnRisk:20 },
  // ハーブピーリング (4名)
  { treatmentName:'ハーブピーリング',         totalSales:135000, visitCount:9,  hasRecentPurchase:false, hasNextRebook:true,  churnRisk:18 },
  { treatmentName:'ハーブピーリング',         totalSales:108000, visitCount:7,  hasRecentPurchase:true,  hasNextRebook:true,  churnRisk:22 },
  { treatmentName:'ハーブピーリング',         totalSales:90000,  visitCount:6,  hasRecentPurchase:false, hasNextRebook:true,  churnRisk:28 },
  { treatmentName:'ハーブピーリング',         totalSales:72000,  visitCount:4,  hasRecentPurchase:false, hasNextRebook:false, churnRisk:35 },
  // モイスチャーフェイシャル (3名)
  { treatmentName:'モイスチャーフェイシャル', totalSales:72000,  visitCount:6,  hasRecentPurchase:false, hasNextRebook:false, churnRisk:30 },
  { treatmentName:'モイスチャーフェイシャル', totalSales:48000,  visitCount:4,  hasRecentPurchase:false, hasNextRebook:true,  churnRisk:25 },
  { treatmentName:'モイスチャーフェイシャル', totalSales:36000,  visitCount:3,  hasRecentPurchase:false, hasNextRebook:false, churnRisk:42 },
  // ホワイトニングケア (2名)
  { treatmentName:'ホワイトニングケア',       totalSales:60000,  visitCount:5,  hasRecentPurchase:false, hasNextRebook:true,  churnRisk:76 },
  { treatmentName:'ホワイトニングケア',       totalSales:36000,  visitCount:3,  hasRecentPurchase:false, hasNextRebook:false, churnRisk:60 },
]

/**
 * customerAnalytics.ts  — AI店舗学習基盤
 *
 * 顧客単体ではなく店舗全体の成功パターンを集計・抽出する。
 * 純粋関数。ダミーデータ対応済み。Supabase 依存なし。
 */

import type { CustomerPhase, CustomerAnalyticsResult, PhaseStats, TopCustomerProfile, StoreInsightItem, CustomerSimilarityResult, SimilarityAxis, VipPromotionResult, VipGapItem } from '@/types'
import { calcCustomerPhase, calcCustomerScore } from '@/lib/phase5/customerRiskEngine'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface AnalyticsCustomerRow {
  id:               string
  visits:           number
  totalSales:       number
  avgPrice:         number
  lineResponseRate: number
  vipRank:          number
  churnRisk:        number
  daysSinceLastVisit:   number
  recommendedCycleDays: number
  hasRecentPurchase:    boolean
}

// ─── 出力型 ──────────────────────────────────────────────────────────────────

// ─── フェーズラベル ───────────────────────────────────────────────────────────

const PHASE_LABEL: Record<CustomerPhase, string> = {
  new:     '新規',
  growing: '育成',
  repeat:  'リピーター',
  vip:     'VIP',
  risk:    '離脱危険',
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function avgArr(arr: number[]): number {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}

// ─── メイン集計関数 ───────────────────────────────────────────────────────────

export function calcCustomerAnalytics(
  customers: AnalyticsCustomerRow[]
): CustomerAnalyticsResult {
  const empty: CustomerAnalyticsResult = {
    phaseStats: [], topProfile: { avgVisits:0, avgLineResponse:0, avgSales:0, purchaseRate:0, count:0 },
    insights: [], totalCustomers: 0,
  }
  if (customers.length === 0) return empty

  // 各顧客にフェーズとスコアを付与
  const enriched = customers.map(c => ({
    ...c,
    phase: calcCustomerPhase({
      visits:               c.visits,
      totalSales:           c.totalSales,
      vipRank:              c.vipRank,
      churnRisk:            c.churnRisk,
      daysSinceLastVisit:   c.daysSinceLastVisit,
      recommendedCycleDays: c.recommendedCycleDays,
    }),
    score: calcCustomerScore({
      visits:           c.visits,
      totalSales:       c.totalSales,
      avgPrice:         c.avgPrice,
      lineResponseRate: c.lineResponseRate,
      vipRank:          c.vipRank,
      churnRisk:        c.churnRisk,
    }).total,
  }))

  // ─── フェーズ別集計 ─────────────────────────────────────────────────────────

  const phases: CustomerPhase[] = ['vip', 'repeat', 'growing', 'new', 'risk']
  const phaseStats: PhaseStats[] = phases
    .map(phase => {
      const group = enriched.filter(c => c.phase === phase)
      if (group.length === 0) return null
      return {
        phase,
        label:        PHASE_LABEL[phase],
        count:        group.length,
        avgSales:     avgArr(group.map(c => c.totalSales)),
        avgVisits:    avgArr(group.map(c => c.visits)),
        purchaseRate: Math.round(group.filter(c => c.hasRecentPurchase).length / group.length * 100),
        rebookRate:   Math.round(100 - avgArr(group.map(c => c.churnRisk))),
      }
    })
    .filter((s): s is PhaseStats => s !== null)

  // ─── 上位20%の共通特徴 ─────────────────────────────────────────────────────

  const sorted = [...enriched].sort((a, b) => b.score - a.score)
  const topN   = Math.max(1, Math.round(sorted.length * 0.2))
  const top    = sorted.slice(0, topN)

  const topProfile: TopCustomerProfile = {
    count:           top.length,
    avgVisits:       avgArr(top.map(c => c.visits)),
    avgLineResponse: avgArr(top.map(c => c.lineResponseRate)),
    avgSales:        avgArr(top.map(c => c.totalSales)),
    purchaseRate:    Math.round(top.filter(c => c.hasRecentPurchase).length / top.length * 100),
  }

  // ─── AIインサイト生成 ──────────────────────────────────────────────────────

  const insights: StoreInsightItem[] = []

  // VIP の店販購入率
  const vipGroup = enriched.filter(c => c.phase === 'vip')
  if (vipGroup.length > 0) {
    const rate = Math.round(vipGroup.filter(c => c.hasRecentPurchase).length / vipGroup.length * 100)
    insights.push({
      id: 'vip_purchase',
      message: `VIP顧客の${rate}%が店販購入経験あり`,
      metric: `${rate}%`,
    })
  }

  // 店販購入者と未購入者の継続率差
  const buyers    = enriched.filter(c => c.hasRecentPurchase)
  const nonBuyers = enriched.filter(c => !c.hasRecentPurchase)
  if (buyers.length > 0 && nonBuyers.length > 0) {
    const buyerContinue    = 100 - avgArr(buyers.map(c => c.churnRisk))
    const nonBuyerContinue = 100 - avgArr(nonBuyers.map(c => c.churnRisk))
    if (nonBuyerContinue > 0) {
      const ratio = (buyerContinue / nonBuyerContinue).toFixed(1)
      insights.push({
        id: 'purchase_rebook',
        message: `店販購入者は次回予約率が${ratio}倍高い`,
        metric: `${ratio}倍`,
      })
    }
  }

  // リピーター以上の LINE 返信率
  const loyalGroup = enriched.filter(c => c.phase === 'vip' || c.phase === 'repeat')
  if (loyalGroup.length > 0) {
    const lineRate = avgArr(loyalGroup.map(c => c.lineResponseRate))
    insights.push({
      id: 'loyal_line',
      message: `リピーター以上の平均LINE返信率${lineRate}%`,
      metric: `${lineRate}%`,
    })
  }

  // 離脱危険顧客
  const riskCount = enriched.filter(c => c.phase === 'risk').length
  if (riskCount > 0) {
    const riskRate = Math.round(riskCount / enriched.length * 100)
    insights.push({
      id: 'risk_count',
      message: `全顧客の${riskRate}%が離脱危険状態（${riskCount}名）`,
      metric: `${riskCount}名`,
    })
  }

  // 上位顧客の特徴
  if (topProfile.avgVisits > 0) {
    insights.push({
      id: 'top_profile',
      message: `上位${topProfile.count}名の平均：来店${topProfile.avgVisits}回・LINE返信率${topProfile.avgLineResponse}%`,
      metric: `${topProfile.avgVisits}回`,
    })
  }

  return { phaseStats, topProfile, insights, totalCustomers: customers.length }
}

// ─── ダミーデータ ──────────────────────────────────────────────────────────────

export const DEMO_ANALYTICS_CUSTOMERS: AnalyticsCustomerRow[] = [
  { id:'c-1', visits:12, totalSales:216000, avgPrice:18000, lineResponseRate:75, vipRank:3, churnRisk:8,  daysSinceLastVisit:14, recommendedCycleDays:30, hasRecentPurchase:true  },
  { id:'c-2', visits:18, totalSales:324000, avgPrice:18000, lineResponseRate:82, vipRank:4, churnRisk:5,  daysSinceLastVisit:7,  recommendedCycleDays:30, hasRecentPurchase:true  },
  { id:'c-3', visits:14, totalSales:252000, avgPrice:18000, lineResponseRate:68, vipRank:3, churnRisk:10, daysSinceLastVisit:10, recommendedCycleDays:30, hasRecentPurchase:true  },
  { id:'c-4', visits:9,  totalSales:135000, avgPrice:15000, lineResponseRate:55, vipRank:1, churnRisk:18, daysSinceLastVisit:18, recommendedCycleDays:30, hasRecentPurchase:false },
  { id:'c-5', visits:6,  totalSales:72000,  avgPrice:12000, lineResponseRate:60, vipRank:0, churnRisk:30, daysSinceLastVisit:21, recommendedCycleDays:30, hasRecentPurchase:false },
  { id:'c-6', visits:4,  totalSales:48000,  avgPrice:12000, lineResponseRate:40, vipRank:0, churnRisk:25, daysSinceLastVisit:32, recommendedCycleDays:30, hasRecentPurchase:false },
  { id:'c-7', visits:3,  totalSales:36000,  avgPrice:12000, lineResponseRate:35, vipRank:0, churnRisk:42, daysSinceLastVisit:28, recommendedCycleDays:30, hasRecentPurchase:false },
  { id:'c-8', visits:5,  totalSales:60000,  avgPrice:12000, lineResponseRate:20, vipRank:0, churnRisk:76, daysSinceLastVisit:62, recommendedCycleDays:30, hasRecentPurchase:false },
]

// ─── VIP類似度計算 ──────────────────────────────────────────────────────────

/**
 * calcSimilarityToVip — VIP顧客との類似度を 0〜100 で算出
 *
 * 1. allCustomers から VIP群（phase=vip）を抽出
 * 2. VIP平均値を計算
 * 3. 各軸の差分を正規化してスコアを算出
 */
export function calcSimilarityToVip(
  target:       AnalyticsCustomerRow,
  allCustomers: AnalyticsCustomerRow[]
): CustomerSimilarityResult {

  // VIP群を抽出（なければ上位20%）
  const enriched = allCustomers.map(c => ({
    ...c,
    phase: calcCustomerPhase({
      visits: c.visits, totalSales: c.totalSales, vipRank: c.vipRank,
      churnRisk: c.churnRisk, daysSinceLastVisit: c.daysSinceLastVisit,
      recommendedCycleDays: c.recommendedCycleDays,
    }),
  }))

  let vipGroup = enriched.filter(c => c.id !== target.id && c.phase === 'vip')
  if (vipGroup.length === 0) {
    const sorted = [...enriched].filter(c => c.id !== target.id)
      .sort((a, b) => b.totalSales - a.totalSales)
    vipGroup = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.2)))
  }
  if (vipGroup.length === 0) {
    return { score: 0, axes: [], summary: '比較対象のVIP顧客がいません' }
  }

  // VIP平均値
  const vipAvgVisits   = avgArr(vipGroup.map(c => c.visits))
  const vipAvgSales    = avgArr(vipGroup.map(c => c.totalSales))
  const vipAvgLine     = avgArr(vipGroup.map(c => c.lineResponseRate))
  const vipPurchRate   = Math.round(vipGroup.filter(c => c.hasRecentPurchase).length / vipGroup.length * 100)

  // 正規化上限値（スケール基準）
  const SCALE = {
    visits:   Math.max(vipAvgVisits * 1.5, 20),
    sales:    Math.max(vipAvgSales  * 1.5, 500000),
    line:     100,
    purchase: 100,
  }

  // 各軸の比較
  type AxisKey = 'visits' | 'sales' | 'line' | 'purchase'
  const axisConfigs: Array<{
    key: AxisKey; label: string; customer: number; vipAvg: number; scale: number
  }> = [
    { key: 'visits',   label: '来店回数',   customer: target.visits,           vipAvg: vipAvgVisits, scale: SCALE.visits  },
    { key: 'sales',    label: '累計売上',   customer: target.totalSales,       vipAvg: vipAvgSales,  scale: SCALE.sales   },
    { key: 'line',     label: 'LINE返信率', customer: target.lineResponseRate,  vipAvg: vipAvgLine,   scale: SCALE.line    },
    { key: 'purchase', label: '店販購入率', customer: target.hasRecentPurchase ? 100 : 0, vipAvg: vipPurchRate, scale: SCALE.purchase },
  ]

  function axisGap(customerNorm: number, vipNorm: number): SimilarityAxis['gap'] {
    const diff = Math.abs(customerNorm - vipNorm)
    if (diff < 0.15) return 'near'
    if (diff < 0.35) return 'close'
    return 'far'
  }

  function axisComment(label: string, gap: SimilarityAxis['gap'], customerNorm: number, vipNorm: number): string {
    if (gap === 'near') return `${label}がVIPと同水準`
    if (gap === 'close') return customerNorm >= vipNorm ? `${label}は十分` : `${label}がやや不足`
    return customerNorm >= vipNorm ? `${label}はVIPを超過` : `${label}が不足`
  }

  const axes: SimilarityAxis[] = axisConfigs.map(({ label, customer, vipAvg, scale }) => {
    const cNorm = Math.min(1, customer / scale)
    const vNorm = Math.min(1, vipAvg   / scale)
    const gap   = axisGap(cNorm, vNorm)
    return {
      label,
      customer: Math.round(cNorm * 100) / 100,
      vipAvg:   Math.round(vNorm * 100) / 100,
      gap,
      comment:  axisComment(label, gap, cNorm, vNorm),
    }
  })

  // 総合スコア: 軸ごとの類似度を平均（near=100, close=65, far=25）
  const gapScore = { near: 100, close: 65, far: 25 }
  const score = Math.round(axes.reduce((s, a) => s + gapScore[a.gap], 0) / axes.length)

  // AIコメント生成
  const nearAxes = axes.filter(a => a.gap === 'near').map(a => a.label)
  const farAxes  = axes.filter(a => a.gap === 'far'  && axes.find(ax => ax.label === a.label)!.customer < axes.find(ax => ax.label === a.label)!.vipAvg)
                       .map(a => a.label)

  let summary = `VIP顧客との類似度${score}%。`
  if (nearAxes.length > 0)  summary += `${nearAxes.join('・')}が近い。`
  if (farAxes.length > 0)   summary += `${farAxes.join('・')}が不足。`
  if (nearAxes.length === 0 && farAxes.length === 0) summary += '全体的にVIPに近づいています。'

  return { score, axes, summary }
}

// ─── VIP昇格シミュレーター ─────────────────────────────────────────────────────

/**
 * calcVipPromotion — VIP昇格に何が不足しているかを算出
 *
 * VIP平均との差分を計算し、不足項目を優先度付きで返す。
 */
export function calcVipPromotion(
  target:       AnalyticsCustomerRow,
  allCustomers: AnalyticsCustomerRow[],
  similarityScore?: number
): VipPromotionResult {

  // 既にVIPかチェック
  const targetPhase = calcCustomerPhase({
    visits: target.visits, totalSales: target.totalSales,
    vipRank: target.vipRank, churnRisk: target.churnRisk,
    daysSinceLastVisit: target.daysSinceLastVisit,
    recommendedCycleDays: target.recommendedCycleDays,
  })

  if (targetPhase === 'vip') {
    return {
      similarityScore: similarityScore ?? 100,
      isAlreadyVip:    true,
      gaps:            [],
      nearestGoal:     null,
      summary:         'すでにVIPのお客様です。特別な体験でさらなる満足度を高めましょう。',
    }
  }

  // VIP群抽出
  const enriched = allCustomers.map(c => ({
    ...c,
    phase: calcCustomerPhase({
      visits: c.visits, totalSales: c.totalSales, vipRank: c.vipRank,
      churnRisk: c.churnRisk, daysSinceLastVisit: c.daysSinceLastVisit,
      recommendedCycleDays: c.recommendedCycleDays,
    }),
  }))
  let vipGroup = enriched.filter(c => c.id !== target.id && c.phase === 'vip')
  if (vipGroup.length === 0) {
    const sorted = [...enriched].filter(c => c.id !== target.id)
      .sort((a, b) => b.totalSales - a.totalSales)
    vipGroup = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.2)))
  }
  if (vipGroup.length === 0) {
    return {
      similarityScore: similarityScore ?? 0,
      isAlreadyVip: false, gaps: [], nearestGoal: null,
      summary: '比較対象のVIP顧客がいません。',
    }
  }

  const vipAvgVisits  = avgArr(vipGroup.map(c => c.visits))
  const vipAvgSales   = avgArr(vipGroup.map(c => c.totalSales))
  const vipAvgLine    = avgArr(vipGroup.map(c => c.lineResponseRate))
  const vipPurchRate  = Math.round(vipGroup.filter(c => c.hasRecentPurchase).length / vipGroup.length * 100)
  const targetPurchRate = target.hasRecentPurchase ? 100 : 0

  // 不足項目を生成（不足がある場合のみ）
  const gaps: VipGapItem[] = []

  // 来店回数
  if (target.visits < vipAvgVisits) {
    const gap = vipAvgVisits - target.visits
    gaps.push({
      label: '来店回数', current: target.visits, vipAvg: vipAvgVisits,
      gap, unit: '回',
      actionText: `あと${gap}回来店`,
      priority: gap <= 3 ? 100 : gap <= 6 ? 70 : 40,
    })
  }

  // 累計売上
  if (target.totalSales < vipAvgSales) {
    const gap = vipAvgSales - target.totalSales
    const gapMan = Math.round(gap / 1000) * 1000  // 千円単位
    gaps.push({
      label: '累計売上', current: target.totalSales, vipAvg: vipAvgSales,
      gap, unit: '円',
      actionText: `あと¥${gapMan.toLocaleString()}の利用`,
      priority: gap <= 50000 ? 90 : gap <= 150000 ? 60 : 30,
    })
  }

  // LINE返信率（20%以上の差がある場合のみ）
  if (vipAvgLine - target.lineResponseRate >= 20) {
    const gap = vipAvgLine - target.lineResponseRate
    gaps.push({
      label: 'LINE返信率', current: target.lineResponseRate, vipAvg: vipAvgLine,
      gap, unit: '%',
      actionText: `LINE返信率を${gap}%改善`,
      priority: 20,
    })
  }

  // 店販購入（VIPがほぼ全員購入しているのに未購入の場合）
  if (vipPurchRate >= 70 && targetPurchRate === 0) {
    gaps.push({
      label: '店販購入', current: 0, vipAvg: vipPurchRate,
      gap: 1, unit: '回',
      actionText: '初回店販購入',
      priority: 55,
    })
  }

  // 優先度順ソート
  gaps.sort((a, b) => b.priority - a.priority)
  const nearestGoal = gaps[0] ?? null

  // AIコメント生成
  const score = similarityScore ?? 0
  let summary = `現在VIP類似度${score}%。`

  if (gaps.length === 0) {
    summary += 'もうすぐVIP到達です！継続が大切です。'
  } else if (nearestGoal) {
    if (nearestGoal.label === '来店回数' && nearestGoal.gap <= 4) {
      summary += `来店回数がVIP平均に近いため、あと${nearestGoal.gap}回来店でVIP到達見込み。`
    } else if (nearestGoal.label === '累計売上') {
      const gapMan = Math.round(nearestGoal.gap / 10000)
      summary += `累計売上があと${gapMan}万円でVIP平均に到達。継続的な来店が鍵です。`
    } else {
      summary += `${nearestGoal.actionText}でVIPに一歩近づきます。`
    }
    if (gaps.length > 1) {
      summary += `他に${gaps.slice(1).map(g => g.label).join('・')}の改善も有効です。`
    }
  }

  return { similarityScore: score, isAlreadyVip: false, gaps, nearestGoal, summary }
}

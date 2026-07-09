/**
 * customerRiskEngine.ts  — PHASE 5
 * 接客データから顧客リスク・関係性ステートを deterministic 推定。
 * AI 不使用。純粋関数。将来 Claude API 差し替えポイント明確化。
 *
 * "言われる前に支援する" 設計：
 *   - 数値スコアをそのまま表示しない
 *   - 自然言語でリスク・状態を表現
 *   - スタッフを「監視」ではなく「支援」する視点
 */

import { supabase, DEMO_MODE } from '@/lib/supabase'
import type {
  CustomerRiskProfile,
  CustomerPhase,
  CustomerScoreResult,
  RelationshipState,
  SilentSuggestion,
} from '@/types'

// ─── 顧客フェーズ自動計算 ──────────────────────────────────────────────────────

/**
 * calcCustomerPhase — 顧客フェーズを自動計算
 *
 * 判定優先順位: risk > vip > repeat > growing > new
 *
 * risk    : churnRisk >= 60
 *           OR daysSinceLastVisit > recommendedCycleDays * 1.5
 * vip     : visits >= 15
 *           OR (visits >= 8 && totalSales >= 300,000)
 *           OR vipRank >= 3
 * repeat  : visits >= 6
 * growing : visits >= 3
 * new     : visits <= 2
 */
export function calcCustomerPhase(input: Pick<
  RiskEngineInput,
  'visits' | 'totalSales' | 'vipRank' |
  'churnRisk' | 'daysSinceLastVisit' | 'recommendedCycleDays'
>): CustomerPhase {
  const { visits, totalSales, vipRank, churnRisk, daysSinceLastVisit, recommendedCycleDays } = input

  // 1. risk（最優先）
  const cycleThreshold = recommendedCycleDays > 0 ? recommendedCycleDays * 1.5 : 90
  if (churnRisk >= 60 || daysSinceLastVisit > cycleThreshold) return 'risk'

  // 2. vip
  if (
    visits >= 15 ||
    (visits >= 8 && totalSales >= 300000) ||
    vipRank >= 3
  ) return 'vip'

  // 3. repeat
  if (visits >= 6) return 'repeat'

  // 4. growing
  if (visits >= 3) return 'growing'

  // 5. new
  return 'new'
}

// ─── 顧客スコア算出 ──────────────────────────────────────────────────────────

/**
 * calcCustomerScore — 顧客スコアを100点満点で算出
 *
 * 配点:
 *   来店回数   25点 (10回で満点)
 *   累計売上   25点 (500,000円で満点)
 *   店販売上   15点 (avg_price * 0.3 を店販率として推定)
 *   LINE返信率 15点 (100%で満点)
 *   紹介実績   10点 (vip_rankから推定)
 *   継続率     10点 (churn_riskの逆数)
 */
export function calcCustomerScore(input: {
  visits:           number
  totalSales:       number
  avgPrice:         number
  lineResponseRate: number
  vipRank:          number
  churnRisk:        number
  hasRecentPurchase?: boolean
}): CustomerScoreResult {
  const { visits, totalSales, avgPrice, lineResponseRate, vipRank, churnRisk } = input

  // 来店回数 (25点: 10回で満点)
  const visitScore    = Math.min(25, Math.round((visits / 10) * 25))

  // 累計売上 (25点: 500,000円で満点)
  const salesScore    = Math.min(25, Math.round((totalSales / 500000) * 25))

  // 店販売上 (15点: avg_price * 訪問数 * 0.2 を店販と推定)
  const retailEst     = avgPrice * visits * 0.2
  const retailScore   = Math.min(15, Math.round((retailEst / 100000) * 15))

  // LINE返信率 (15点)
  const lineScore     = Math.min(15, Math.round((lineResponseRate / 100) * 15))

  // 紹介実績 (10点: vipRankから推定)
  const referralScore = Math.min(10, vipRank * 3)

  // 継続率 (10点: churnRiskの逆数)
  const retentionScore = Math.min(10, Math.round(((100 - churnRisk) / 100) * 10))

  const total = visitScore + salesScore + retailScore + lineScore + referralScore + retentionScore

  // フェーズ判定
  const phase: CustomerPhase =
    total >= 90 ? 'vip'     :
    total >= 70 ? 'repeat'  :
    total >= 40 ? 'growing' : 'risk'

  return {
    total,
    phase,
    breakdown: {
      visits:       { score: visitScore,     max: 25, label: '来店回数' },
      sales:        { score: salesScore,     max: 25, label: '累計売上' },
      retailSales:  { score: retailScore,    max: 15, label: '店販売上' },
      lineResponse: { score: lineScore,      max: 15, label: 'LINE返信率' },
      referral:     { score: referralScore,  max: 10, label: '紹介実績' },
      retention:    { score: retentionScore, max: 10, label: '継続率' },
    },
  }
}

export interface RiskEngineInput {
  customerId:           string
  visits:               number
  totalSales:           number
  lineResponseRate:     number
  vipRank:              number
  churnRisk:            number          // DB 既存値（0〜100）
  daysSinceLastVisit:   number
  recommendedCycleDays: number
  recentActionTypes:    string[]        // 直近30日のアクション
  insightTags:          string[]
  hasRecentPurchase:    boolean
  avgPrice:             number
}

// ─── リスクプロファイル生成 ───────────────────────────────────────────────────

export function buildRiskProfile(input: RiskEngineInput): CustomerRiskProfile {
  const {
    visits, lineResponseRate, churnRisk,
    daysSinceLastVisit, recommendedCycleDays,
    recentActionTypes, insightTags, hasRecentPurchase, avgPrice,
  } = input

  const riskFactors:     string[] = []
  const positiveFactors: string[] = []

  // ── 離脱リスク ────────────────────────────────────────────────────────────
  let churnScore = churnRisk  // DB既存値をベースに補正

  // 来店周期超過で加算
  const cycleOverRate = daysSinceLastVisit / Math.max(recommendedCycleDays, 1)
  if (cycleOverRate > 1.8) { churnScore += 20; riskFactors.push(`来店周期が大幅に超過`) }
  else if (cycleOverRate > 1.2) { churnScore += 10; riskFactors.push(`来店周期がやや遅れ気味`) }

  // LINE低反応で加算（PHASE UX-2: churnScoreへの加点は維持・表示文言のみ削除）
  if (lineResponseRate < 40) { churnScore += 15 }
  else if (lineResponseRate < 65) { churnScore += 7 }

  // フォローアクションなし
  const hasFollowAction = recentActionTypes.some(t =>
    ['line_sent', 'next_action_line', 'next_action_inactive'].includes(t)
  )
  if (!hasFollowAction && daysSinceLastVisit > 20) {
    churnScore += 10
    riskFactors.push(`最近フォローできていません`)
  }

  // ポジティブ要因（PHASE UX-2: 「LINE反応率が高い」を削除）
  if (hasRecentPurchase) positiveFactors.push(`最近商品を購入しています`)
  if (insightTags.includes('high_motivation')) positiveFactors.push(`来店モチベーションが高い`)
  if (visits >= 10) positiveFactors.push(`長期ご愛顧のお客様`)

  const churnProbability: CustomerRiskProfile['churnProbability'] =
    churnScore >= 70 ? 'high' : churnScore >= 40 ? 'medium' : 'low'

  // ── 再来可能性 ────────────────────────────────────────────────────────────
  let returnScore = 50

  // 来店頻度が安定していれば加点
  if (visits >= 5 && cycleOverRate <= 1.1) returnScore += 25
  else if (visits >= 3) returnScore += 10

  // 予約アクションがあれば大幅加点
  if (recentActionTypes.includes('rebook_recommended') ||
      recentActionTypes.includes('next_action_rebook')) returnScore += 20

  if (insightTags.includes('high_motivation')) returnScore += 15
  if (insightTags.includes('event_before'))    returnScore += 10

  const returnLikelihood: CustomerRiskProfile['returnLikelihood'] =
    returnScore >= 70 ? 'high' : returnScore >= 40 ? 'medium' : 'low'

  // ── 提案成功率 ────────────────────────────────────────────────────────────
  let offerScore = 50

  if (avgPrice >= 20000)          offerScore += 20
  if (insightTags.includes('event_before'))      offerScore += 20
  if (insightTags.includes('high_motivation'))   offerScore += 15
  if (!insightTags.includes('price_sensitive'))  offerScore += 10
  if (hasRecentPurchase)          offerScore += 10
  if (insightTags.includes('price_sensitive'))   offerScore -= 20

  const offerSuccessRate: CustomerRiskProfile['offerSuccessRate'] =
    offerScore >= 70 ? 'high' : offerScore >= 40 ? 'medium' : 'low'

  return { churnProbability, returnLikelihood, offerSuccessRate, riskFactors, positiveFactors }
}

// ─── 関係性ステート推定 ───────────────────────────────────────────────────────

export function buildRelationshipState(input: RiskEngineInput): RelationshipState {
  const { visits, churnRisk, daysSinceLastVisit, recommendedCycleDays, lineResponseRate, insightTags } = input
  const cycleOverRate = daysSinceLastVisit / Math.max(recommendedCycleDays, 1)

  // 最優先: 危険シグナル
  if (churnRisk >= 70 || cycleOverRate > 1.8) return 'at_risk'

  // 冷却シグナル
  if (cycleOverRate > 1.2 || lineResponseRate < 50) return 'cooling'

  // 深化シグナル（モチベ高・来店頻度安定）
  if (insightTags.includes('high_motivation') && visits >= 5 && cycleOverRate <= 1.0) return 'growing'

  // 安定
  if (visits >= 5 && cycleOverRate <= 1.1 && lineResponseRate >= 60) return 'stable'

  // 関係形成中（新規〜3回）
  return 'forming'
}

// ─── Supabase: アクション・insightタグを並列取得 ─────────────────────────────

export async function fetchRiskEngineContext(customerId: string): Promise<{
  recentActionTypes: string[]
  insightTags:       string[]
  hasRecentPurchase: boolean
}> {
  // DEMO_MODE: Supabase を呼ばない（placeholder.supabase.co 通信を防止）
  if (DEMO_MODE) {
    return {
      recentActionTypes: ['line_sent', 'homecare_explained'],
      insightTags:       ['dry_skin', 'aging_care'],
      hasRecentPurchase: false,
    }
  }

  const since30  = new Date(Date.now() -  30 * 86400000).toISOString()
  const since90  = new Date(Date.now() -  90 * 86400000).toISOString()

  const [actRes, insightRes, purchaseRes] = await Promise.allSettled([
    supabase.from('customer_action_logs').select('action_type')
      .eq('customer_id', customerId).gte('created_at', since30),
    supabase.from('voice_notes').select('insight_tags')
      .eq('customer_id', customerId).not('insight_tags', 'is', null)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('customer_action_logs').select('id')
      .eq('customer_id', customerId).eq('action_type', 'product_purchased')
      .gte('created_at', since90).limit(1),
  ])

  const recentActionTypes = actRes.status === 'fulfilled' && actRes.value.data
    ? actRes.value.data.map(r => r.action_type as string) : []

  const insightTags = insightRes.status === 'fulfilled' && insightRes.value.data
    ? Array.from(new Set(insightRes.value.data.flatMap(r => (r.insight_tags ?? []) as string[])))
    : []

  const hasRecentPurchase = purchaseRes.status === 'fulfilled'
    ? (purchaseRes.value.data?.length ?? 0) > 0 : false

  return { recentActionTypes, insightTags, hasRecentPurchase }
}

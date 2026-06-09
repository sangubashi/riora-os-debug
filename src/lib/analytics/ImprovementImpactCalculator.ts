/**
 * ImprovementImpactCalculator.ts
 *
 * 各 KPI 指標の改善が月次売上にどれだけ影響するかを金額で推定する。
 *
 * 計算式:
 *   店販率      差分(%) × 月来店数 × 平均商品単価 ÷ 100
 *   次回予約率  差分(%) × 月来店数 × 平均客単価   ÷ 100
 *   LINE返信率  差分(%) × 月来店数 × 平均客単価 × 再来率 ÷ 100
 *   リピート率  差分(%) × 月来店数 × 平均客単価   ÷ 100
 *   VIP化率     差分(%) × 月来店数 × VIP平均単価  ÷ 100
 *   離脱率      差分(%) × 月来店数 × 平均客単価   ÷ 100（離脱防止インパクト）
 */

import type { AnalysisInput, AnalysisBenchmark } from './ImprovementAnalyzer'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface ImpactInput extends AnalysisInput {
  monthlyVisits:    number   // 月来店数
  avgSpend:         number   // 平均客単価（円）
  avgProductPrice:  number   // 平均商品単価（円）
}

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export interface ImpactItem {
  metric:                 string
  label:                  string
  currentValue:           number   // 現在値（%）
  benchmarkValue:         number   // サロン平均（%）
  diffPct:                number   // 差分（%）
  estimatedMonthlyImpact: number   // 月次改善インパクト（円）
  recommendation:         string
  priority:               'critical' | 'high' | 'medium' | 'low'
}

export interface ImpactCalculatorResult {
  items:             ImpactItem[]
  totalImpact:       number         // 全改善を実行した場合の月次インパクト合計
  topItem:           ImpactItem | null
}

// ─── ベンチマーク（ImprovementAnalyzer と共通） ──────────────────────────────

const BENCHMARK: AnalysisBenchmark = {
  nextReserveRate:  70,
  repeatRate:       72,
  retailRate:       35,
  avgSpend:         13000,
  churnRate:        20,
  vipRate:          15,
  lineResponseRate: 60,
}

const AVG_PRODUCT_PRICE   = 4500    // 平均商品単価（デフォルト）
const REVISIT_RATE        = 0.60    // LINE送信後の再来率
const VIP_AVG_SPEND_RATIO = 2.2     // VIP は平均客単価の2.2倍

// ─── 優先度判定 ──────────────────────────────────────────────────────────────

function toPriority(impact: number): ImpactItem['priority'] {
  if (impact >= 50000) return 'critical'
  if (impact >= 25000) return 'high'
  if (impact >= 10000) return 'medium'
  return 'low'
}

// ─── メイン算出関数 ───────────────────────────────────────────────────────────

export function calcImprovementImpact(input: ImpactInput): ImpactCalculatorResult {
  const bm      = { ...BENCHMARK, ...input.benchmark }
  const visits  = Math.max(input.monthlyVisits, 1)
  const spend   = input.avgSpend || 14000
  const product = input.avgProductPrice || AVG_PRODUCT_PRICE

  const items: ImpactItem[] = []

  // ── 次回予約率 ──────────────────────────────────────────────────────────────
  {
    const diff = bm.nextReserveRate - input.nextReserveRate   // マイナスなら改善余地
    if (diff > 0) {
      // diff% 分の追加予約 × 客単価
      const impact = Math.round((diff / 100) * visits * spend)
      items.push({
        metric: 'nextReserveRate', label: '次回予約率',
        currentValue: input.nextReserveRate, benchmarkValue: bm.nextReserveRate,
        diffPct: -diff, estimatedMonthlyImpact: impact,
        recommendation: '施術終了10分前に「次回はいつ頃にしましょうか」と自然に提案する。',
        priority: toPriority(impact),
      })
    }
  }

  // ── 店販率 ──────────────────────────────────────────────────────────────────
  {
    const diff = bm.retailRate - input.retailRate
    if (diff > 0) {
      const impact = Math.round((diff / 100) * visits * product)
      items.push({
        metric: 'retailRate', label: '店販率',
        currentValue: input.retailRate, benchmarkValue: bm.retailRate,
        diffPct: -diff, estimatedMonthlyImpact: impact,
        recommendation: '施術終了10分前に「お家でも続けられるケアがあります」と商品を紹介する。',
        priority: toPriority(impact),
      })
    }
  }

  // ── LINE返信率 ──────────────────────────────────────────────────────────────
  {
    const diff = bm.lineResponseRate - input.lineResponseRate
    if (diff > 0) {
      // 返信率が上がると来店率も上がる想定
      const impact = Math.round((diff / 100) * visits * spend * REVISIT_RATE)
      items.push({
        metric: 'lineResponseRate', label: 'LINE返信率',
        currentValue: input.lineResponseRate, benchmarkValue: bm.lineResponseRate,
        diffPct: -diff, estimatedMonthlyImpact: impact,
        recommendation: 'キャンペーン文ではなく美容アドバイス中心のメッセージに変更する。',
        priority: toPriority(impact),
      })
    }
  }

  // ── リピート率 ──────────────────────────────────────────────────────────────
  {
    const diff = bm.repeatRate - input.repeatRate
    if (diff > 0) {
      const impact = Math.round((diff / 100) * visits * spend)
      items.push({
        metric: 'repeatRate', label: 'リピート率',
        currentValue: input.repeatRate, benchmarkValue: bm.repeatRate,
        diffPct: -diff, estimatedMonthlyImpact: impact,
        recommendation: '初回来店後7日以内に「お肌の調子はいかがですか？」とLINEフォローする。',
        priority: toPriority(impact),
      })
    }
  }

  // ── VIP化率 ─────────────────────────────────────────────────────────────────
  {
    const diff = bm.vipRate - input.vipRate
    if (diff > 0) {
      const vipSpend = Math.round(spend * VIP_AVG_SPEND_RATIO)
      const impact   = Math.round((diff / 100) * visits * (vipSpend - spend))
      items.push({
        metric: 'vipRate', label: 'VIP化率',
        currentValue: input.vipRate, benchmarkValue: bm.vipRate,
        diffPct: -diff, estimatedMonthlyImpact: impact,
        recommendation: 'VIP候補（類似度70%以上）に対して上位コースの体験提案を増やす。',
        priority: toPriority(impact),
      })
    }
  }

  // ── 離脱率 ──────────────────────────────────────────────────────────────────
  {
    const diff = input.churnRate - bm.churnRate   // 高いほど悪い
    if (diff > 0) {
      const impact = Math.round((diff / 100) * visits * spend)
      items.push({
        metric: 'churnRate', label: '離脱率',
        currentValue: input.churnRate, benchmarkValue: bm.churnRate,
        diffPct: diff, estimatedMonthlyImpact: impact,
        recommendation: '来店後7日以内のLINEフォローを強化し、次回予約率を高める。',
        priority: toPriority(impact),
      })
    }
  }

  // インパクト降順でソート
  items.sort((a, b) => b.estimatedMonthlyImpact - a.estimatedMonthlyImpact)

  const totalImpact = items.reduce((s, i) => s + i.estimatedMonthlyImpact, 0)
  const topItem     = items[0] ?? null

  return { items, totalImpact, topItem }
}

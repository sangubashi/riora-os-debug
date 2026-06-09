/**
 * ImprovementAnalyzer.ts
 *
 * KPI データから「なぜ良いのか」「なぜ悪いのか」「何を改善するか」を
 * 自動分析して優先度付きで返す純粋関数モジュール。
 *
 * 外部API不使用。ルールベース。
 */

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface AnalysisInput {
  // KPI 実測値
  nextReserveRate:  number   // % 次回予約率
  repeatRate:       number   // % リピート率
  retailRate:       number   // % 店販率（店販あり顧客 / 全顧客）
  avgSpend:         number   // 円 客単価
  churnRate:        number   // % 離脱率（churnRisk >= 60 の割合）
  vipRate:          number   // % VIP率
  lineResponseRate: number   // % LINE返信率

  // 業界ベンチマーク（省略時はデフォルト値を使用）
  benchmark?: Partial<AnalysisBenchmark>
}

export interface AnalysisBenchmark {
  nextReserveRate:  number
  repeatRate:       number
  retailRate:       number
  avgSpend:         number
  churnRate:        number
  vipRate:          number
  lineResponseRate: number
}

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export type InsightPriority = 'critical' | 'high' | 'medium' | 'low'

export interface Strength {
  metric:      string
  label:       string
  value:       string
  diff:        string    // 「平均より+22%」
  reason:      string
  advice:      string    // 継続・強化アドバイス
}

export interface Weakness {
  metric:      string
  label:       string
  value:       string
  diff:        string
  reason:      string
  recommendation: string
  priority:    InsightPriority
}

export interface ImprovementAnalysisResult {
  strengths:       Strength[]
  weaknesses:      Weakness[]
  topRecommendation: Weakness | null   // 最優先改善項目
  overallPriority:   InsightPriority
  summary:           string
}

// ─── ベンチマーク（サロン業界標準値） ─────────────────────────────────────────

const DEFAULT_BENCHMARK: AnalysisBenchmark = {
  nextReserveRate:  70,   // 次回予約率 70%
  repeatRate:       72,   // リピート率 72%
  retailRate:       35,   // 店販率 35%
  avgSpend:         13000, // 客単価 ¥13,000
  churnRate:        20,   // 離脱率 20%以下が良好
  vipRate:          15,   // VIP率 15%
  lineResponseRate: 60,   // LINE返信率 60%
}

// ─── 閾値定数 ─────────────────────────────────────────────────────────────────

const THRESHOLD = {
  strength_margin: 10,   // 平均より10%以上高い → 強み
  weakness_margin: 10,   // 平均より10%以上低い → 改善対象
  critical_margin: 20,   // 平均より20%以上低い → 最優先
}

// ─── フォーマットヘルパー ─────────────────────────────────────────────────────

function fmtPct(n: number): string { return `${n}%` }
function fmtYen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 1000)}K` : `¥${n.toLocaleString()}`
}
function diffStr(diff: number, unit = '%'): string {
  return diff > 0 ? `平均より+${diff}${unit}` : `平均より${diff}${unit}`
}

// ─── 各メトリクス分析 ─────────────────────────────────────────────────────────

function analyzeNextReserveRate(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diff = Math.round(value - bm)
  if (diff >= THRESHOLD.strength_margin) {
    return {
      strength: {
        metric:  'nextReserveRate',
        label:   '次回予約率',
        value:   fmtPct(value),
        diff:    diffStr(diff),
        reason:  'クロージング成功率が高く、顧客の継続意欲を引き出せています。',
        advice:  '施術後のホームケアアドバイスとセットで次回日程を提案する流れを他スタッフにも展開しましょう。',
      },
    }
  }
  if (diff <= -THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diff <= -THRESHOLD.critical_margin ? 'critical' : 'high'
    return {
      weakness: {
        metric:   'nextReserveRate',
        label:    '次回予約率',
        value:    fmtPct(value),
        diff:     diffStr(diff),
        reason:   'リピート率に比べ次回予約の取得が少なく、次回来店まで期間が空きやすい状況です。',
        recommendation: '施術終了5分前に「次回はいつ頃にしましょうか」と自然に聞く習慣をつけましょう。',
        priority,
      },
    }
  }
  return {}
}

function analyzeRepeatRate(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diff = Math.round(value - bm)
  if (diff >= THRESHOLD.strength_margin) {
    return {
      strength: {
        metric: 'repeatRate',
        label:  'リピート率',
        value:  fmtPct(value),
        diff:   diffStr(diff),
        reason: '顧客の満足度が高く、信頼関係が構築できています。',
        advice: 'VIP化への橋渡しとして、定期コースや回数券の提案タイミングを増やしましょう。',
      },
    }
  }
  if (diff <= -THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diff <= -THRESHOLD.critical_margin ? 'critical' : 'high'
    return {
      weakness: {
        metric:   'repeatRate',
        label:    'リピート率',
        value:    fmtPct(value),
        diff:     diffStr(diff),
        reason:   '新規顧客の取り込みに対し、2回目以降への転換が弱い可能性があります。',
        recommendation: '初回来店後7日以内に「施術後のお肌の調子はいかがですか？」とLINEでフォローしましょう。',
        priority,
      },
    }
  }
  return {}
}

function analyzeRetailRate(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diff = Math.round(value - bm)
  if (diff >= THRESHOLD.strength_margin) {
    return {
      strength: {
        metric: 'retailRate',
        label:  '店販率',
        value:  fmtPct(value),
        diff:   diffStr(diff),
        reason: '施術と連動した商品提案が自然にできています。',
        advice: '人気商品の在庫確認と、季節に合わせた新商品提案も継続しましょう。',
      },
    }
  }
  if (diff <= -THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diff <= -THRESHOLD.critical_margin ? 'critical' : 'high'
    return {
      weakness: {
        metric:   'retailRate',
        label:    '店販率',
        value:    fmtPct(value),
        diff:     diffStr(diff),
        reason:   'リピート率は高いが、ホームケア商品の提案回数が少ない可能性があります。',
        recommendation: '施術終了10分前に「お家でも続けられるケアがあります」と自然に商品を紹介しましょう。',
        priority,
      },
    }
  }
  return {}
}

function analyzeChurnRate(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diff = Math.round(value - bm)
  // 離脱率は低いほど良い（差分の符号が逆）
  if (diff <= -THRESHOLD.strength_margin) {
    return {
      strength: {
        metric: 'churnRate',
        label:  '離脱率',
        value:  fmtPct(value),
        diff:   `平均より${Math.abs(diff)}%低い`,
        reason: '顧客の継続率が高く、来店サイクルが安定しています。',
        advice: '離脱予防の取り組みを継続し、特に新規→リピーター転換を意識しましょう。',
      },
    }
  }
  if (diff >= THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diff >= THRESHOLD.critical_margin ? 'critical' : 'high'
    return {
      weakness: {
        metric:   'churnRate',
        label:    '離脱率',
        value:    fmtPct(value),
        diff:     `平均より+${diff}%高い`,
        reason:   '来店間隔が空いている顧客が増えており、離脱リスクが蓄積しています。',
        recommendation: '来店後7日以内のLINEフォローを強化し、次回予約率を高めましょう。',
        priority,
      },
    }
  }
  return {}
}

function analyzeVipRate(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diff = Math.round(value - bm)
  if (diff >= THRESHOLD.strength_margin) {
    return {
      strength: {
        metric: 'vipRate',
        label:  'VIP化率',
        value:  fmtPct(value),
        diff:   diffStr(diff),
        reason: '高単価顧客の育成が得意で、LTV向上に直結しています。',
        advice: 'VIP顧客への専用メニューや優先予約枠を設けると離脱率がさらに下がります。',
      },
    }
  }
  if (diff <= -THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diff <= -THRESHOLD.critical_margin ? 'high' : 'medium'
    return {
      weakness: {
        metric:   'vipRate',
        label:    'VIP化率',
        value:    fmtPct(value),
        diff:     diffStr(diff),
        reason:   'リピーターは多いが高単価への引き上げ機会が少ない可能性があります。',
        recommendation: 'VIP候補（類似度70%以上）に対して上位コースの体験提案を増やしましょう。',
        priority,
      },
    }
  }
  return {}
}

function analyzeLineResponseRate(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diff = Math.round(value - bm)
  if (diff >= THRESHOLD.strength_margin) {
    return {
      strength: {
        metric: 'lineResponseRate',
        label:  'LINE返信率',
        value:  fmtPct(value),
        diff:   diffStr(diff),
        reason: '顧客とのLINEコミュニケーションが良好で、来店動機につながっています。',
        advice: '返信率の高い顧客をVIP化候補として優先フォローしましょう。',
      },
    }
  }
  if (diff <= -THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diff <= -THRESHOLD.critical_margin ? 'high' : 'medium'
    return {
      weakness: {
        metric:   'lineResponseRate',
        label:    'LINE返信率',
        value:    fmtPct(value),
        diff:     diffStr(diff),
        reason:   'メッセージの内容が営業色が強く、顧客が反応しにくい可能性があります。',
        recommendation: 'キャンペーン文ではなく美容アドバイス中心のメッセージに変更しましょう。',
        priority,
      },
    }
  }
  return {}
}

function analyzeAvgSpend(
  value: number, bm: number
): { strength?: Strength; weakness?: Weakness } {
  const diffPct = Math.round(((value - bm) / bm) * 100)
  if (diffPct >= THRESHOLD.strength_margin) {
    return {
      strength: {
        metric: 'avgSpend',
        label:  '客単価',
        value:  fmtYen(value),
        diff:   `平均より+${diffPct}%`,
        reason: '高単価メニューや追加オプションの提案が上手くできています。',
        advice: 'この水準を維持しながら来店頻度も上げる提案（定期コース等）を加えましょう。',
      },
    }
  }
  if (diffPct <= -THRESHOLD.weakness_margin) {
    const priority: InsightPriority = diffPct <= -THRESHOLD.critical_margin ? 'high' : 'medium'
    return {
      weakness: {
        metric:   'avgSpend',
        label:    '客単価',
        value:    fmtYen(value),
        diff:     `平均より${diffPct}%`,
        reason:   '基本メニューのみの利用が多く、追加提案の機会が活かされていません。',
        recommendation: '施術中に「今日の状態に合わせて追加ケアを」とオプションを自然に提案しましょう。',
        priority,
      },
    }
  }
  return {}
}

// ─── 優先度スコア ─────────────────────────────────────────────────────────────

const PRIORITY_SCORE: Record<InsightPriority, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
}

// ─── メイン分析関数 ───────────────────────────────────────────────────────────

export function analyzeImprovements(
  input: AnalysisInput
): ImprovementAnalysisResult {
  const bm: AnalysisBenchmark = { ...DEFAULT_BENCHMARK, ...input.benchmark }

  const strengths:  Strength[] = []
  const weaknesses: Weakness[] = []

  const checks = [
    analyzeNextReserveRate(input.nextReserveRate,  bm.nextReserveRate),
    analyzeRepeatRate(input.repeatRate,            bm.repeatRate),
    analyzeRetailRate(input.retailRate,            bm.retailRate),
    analyzeChurnRate(input.churnRate,              bm.churnRate),
    analyzeVipRate(input.vipRate,                  bm.vipRate),
    analyzeLineResponseRate(input.lineResponseRate, bm.lineResponseRate),
    analyzeAvgSpend(input.avgSpend,                bm.avgSpend),
  ]

  for (const { strength, weakness } of checks) {
    if (strength) strengths.push(strength)
    if (weakness) weaknesses.push(weakness)
  }

  // 改善対象を優先度降順でソート
  weaknesses.sort(
    (a, b) => PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority]
  )

  const topRecommendation = weaknesses[0] ?? null

  const overallPriority: InsightPriority =
    topRecommendation?.priority ?? (strengths.length > 0 ? 'low' : 'medium')

  const summary = (() => {
    if (weaknesses.length === 0 && strengths.length > 0) {
      return `全指標が良好です。${strengths[0].label}が特に優秀です。`
    }
    if (topRecommendation) {
      return `${topRecommendation.label}（${topRecommendation.diff}）が最優先改善項目です。`
    }
    return '分析中です。データが蓄積されると精度が上がります。'
  })()

  return { strengths, weaknesses, topRecommendation, overallPriority, summary }
}

// ─── KpiSnapshot からの変換ヘルパー ─────────────────────────────────────────

import type { CustomerRow } from '@/store/useCustomerStore'

/**
 * useKpiStore の KpiSnapshot + useCustomerStore の customers から
 * AnalysisInput を生成する。
 */
export function buildAnalysisInput(params: {
  nextReserveRate:  number
  repeatRate:       number
  lineResponseRate: number
  avgSpend:         number
  vipRate:          number
  customers:        CustomerRow[]
}): AnalysisInput {
  const { customers } = params
  const total = customers.length || 1

  // 店販率: totalSpent > avgSpend * visitCount * 1.2 → 店販あり（推定）
  const retailCount = customers.filter(c =>
    c.visitCount > 0 && c.totalSpent > (c.totalSpent / c.visitCount) * c.visitCount * 1.0
  ).length
  const retailRate = Math.round((retailCount / total) * 100)

  // 離脱率: churnRisk >= 60
  const churnCount = customers.filter(c => c.churnRisk >= 60).length
  const churnRate  = Math.round((churnCount / total) * 100)

  return {
    nextReserveRate:  params.nextReserveRate,
    repeatRate:       params.repeatRate,
    retailRate,
    avgSpend:         params.avgSpend,
    churnRate,
    vipRate:          params.vipRate,
    lineResponseRate: params.lineResponseRate,
  }
}

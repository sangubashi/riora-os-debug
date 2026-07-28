/**
 * computeDashboardHighlights.ts — 経営TOP「今月危険アラート」「今月良かったこと」
 * 「今週やること」の生成ロジック(管理者ダッシュボード完成度向上・API変更禁止のため実装)
 *
 * AIWarningEngine.ts(server-side・nightly・DBライブ集計)とは異なり、こちらは
 * GET /api/dashboard/topが既に返している値(required4/kpi4/extendedKpi/todayActions/
 * salesTrend)だけを入力に取る純粋関数。新しいAPI呼び出し・DB集計は一切行わない。
 *
 * 「今月良かったこと」「今週やること」は、前月比較データがAPIに含まれていないため
 * (DashboardAggregator内部では前月値を保持しているが、API応答には未出力)、
 * 前月比の「改善しました」的な主張は行わない。ここで生成する文言は、
 *   - 今月時点の値がしきい値を満たしているという事実(閾値評価)
 *   - 当月salesTrend(日次)から算出できる月内の直近ペース比較
 *   - todayActions(AIWarningEngine出力・既に実データ)の集約
 * のいずれかから導出できる範囲のみに限定している(データが無い主張は生成しない)。
 */
import type { TodayAction, SalesTrendPoint } from '../../store/useDashboardTopStore'

export interface DashboardHighlightsInput {
  monthlySales: number
  salesTarget: number | null
  targetProgress: number | null
  laborCostRate: number | null
  nominationRate: number | null
  todayActions: TodayAction[]
  salesTrend: SalesTrendPoint[]
  /** 表示月の基準日(YYYY-MM-DD、選択月の月末 or 今日)。ペース計算に使う。 */
  asOfDate: string
  month: string
}

export interface RiskAlert {
  title: string
  message: string
  severity: 'critical' | 'warning'
}

export interface GoodNewsItem {
  message: string
}

export interface WeeklyFocusItem {
  message: string
  count: number | null
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 月内の経過日数(1〜daysInMonth)。asOfDateがその月の範囲外の場合はdaysInMonthにクランプする。 */
function elapsedDaysInMonth(month: string, asOfDate: string): number {
  const total = daysInMonth(month)
  const asOf = new Date(`${asOfDate}T00:00:00`)
  const monthStart = new Date(`${month}-01T00:00:00`)
  const diff = Math.floor((asOf.getTime() - monthStart.getTime()) / 86_400_000) + 1
  return Math.min(Math.max(diff, 1), total)
}

/**
 * ①今月危険アラート。人件費率50%超は本関数で新たに定義した閾値判定(既存の
 * fixedCosts/monthlySalesから導出・API変更なし)。それ以外はAIWarningEngineが
 * 既に検知済みの重大/警告アラート(todayActions)をそのまま採用する
 * (リピート率低下・指名率低下・来店周期超過・失客予兆など)。
 *
 * 「予約数減少」「物販率低下」はAPIに前月比較データ・店販/施術内訳が無いため、
 * 実データが無い主張を避ける目的でここでは生成しない(残課題として別途報告)。
 */
export function computeRiskAlerts(input: DashboardHighlightsInput): RiskAlert[] {
  const alerts: RiskAlert[] = []

  if (input.laborCostRate !== null && input.laborCostRate > 50) {
    alerts.push({
      title: '人件費率が50%を超えています',
      message: `今月の人件費率は${input.laborCostRate.toFixed(1)}%です。売上に対する人件費の割合が高くなっています。`,
      severity: 'critical',
    })
  }

  for (const action of input.todayActions) {
    if (action.severity === 'critical' || action.severity === 'warning') {
      alerts.push({ title: action.title, message: action.message, severity: action.severity })
    }
  }

  return alerts
}

/**
 * ②今月良かったこと。前月比較データがAPIに無いため「改善しました」ではなく、
 * 「今この基準を満たしている」という事実ベースの文言にしている。
 * 月内ペース比較(salesTrend)のみ、直近と月初のペースを比較する形の相対評価を行う。
 */
export function computeGoodNews(input: DashboardHighlightsInput): GoodNewsItem[] {
  const items: GoodNewsItem[] = []

  if (input.laborCostRate !== null && input.laborCostRate <= 35) {
    items.push({ message: `人件費率は${input.laborCostRate.toFixed(1)}%で、健全な水準を保っています。` })
  }

  if (input.nominationRate !== null && input.nominationRate >= 0.4) {
    items.push({ message: `指名率は${Math.round(input.nominationRate * 100)}%と高い水準です。` })
  }

  if (input.targetProgress !== null && input.salesTarget !== null && input.salesTarget > 0) {
    const elapsed = elapsedDaysInMonth(input.month, input.asOfDate)
    const total = daysInMonth(input.month)
    const expectedProgress = elapsed / total
    if (expectedProgress > 0 && input.targetProgress / expectedProgress >= 1) {
      items.push({ message: '売上目標に対して、月内の経過日数に見合った、またはそれ以上のペースで進んでいます。' })
    }
  }

  if (input.salesTrend.length >= 6) {
    const midpoint = Math.floor(input.salesTrend.length / 2)
    const earlier = input.salesTrend.slice(0, midpoint)
    const recent = input.salesTrend.slice(midpoint)
    const avg = (points: SalesTrendPoint[]) => points.reduce((sum, p) => sum + p.monthlySales, 0) / points.length
    const earlierAvg = avg(earlier)
    const recentAvg = avg(recent)
    if (earlierAvg > 0 && recentAvg > earlierAvg * 1.05) {
      items.push({ message: '今月に入ってからの売上の伸び方が、月初より上向いています。' })
    }
  }

  const hasRisk = input.todayActions.some((a) => a.severity === 'critical' || a.severity === 'warning')
  if (!hasRisk && input.todayActions.length === 0) {
    items.push({ message: '現在、特に大きな注意点は見つかっていません。' })
  }

  return items
}

/**
 * ③今週やること。todayActions(AIWarningEngine実データ)をactionType別に集約するだけ
 * (新しい示唆は生成しない・既存の実データの要約表示)。
 */
export function computeWeeklyFocus(input: DashboardHighlightsInput): WeeklyFocusItem[] {
  const byType = new Map<TodayAction['actionType'], { count: number; sample: string }>()
  for (const action of input.todayActions) {
    const existing = byType.get(action.actionType)
    if (existing) {
      existing.count += action.targetCount
    } else {
      byType.set(action.actionType, { count: action.targetCount, sample: action.title })
    }
  }

  const LABELS: Record<TodayAction['actionType'], (count: number, sample: string) => string> = {
    contact_customer: (count) => `顧客への連絡を${count}件検討してください`,
    send_line: (count) => `LINEフォローを${count}件検討してください`,
    review_staff: (count, sample) => `スタッフとの確認・共有を行ってください(${sample})`,
    upsell_campaign: (count) => `ホームケア・アップセル提案の強化を${count}件検討してください`,
  }

  const items: WeeklyFocusItem[] = []
  for (const [actionType, { count, sample }] of Array.from(byType.entries())) {
    items.push({ message: LABELS[actionType](count, sample), count })
  }

  if (items.length === 0) {
    items.push({ message: '特に緊急の対応はありません。通常運営を継続してください。', count: null })
  }

  return items
}

/**
 * GenerateDailyTodo.ts
 *
 * 毎朝3件の「今日やること」を生成する。
 * customers / KPI / 改善インパクトを元にルールベースで生成。
 */

import type { CustomerRow }    from '@/store/useCustomerStore'
import type { ImpactItem }     from './ImprovementImpactCalculator'

// ─── 型 ──────────────────────────────────────────────────────────────────────

export interface DailyTodo {
  rank:            number
  action:          string
  detail:          string
  expectedRevenue: number   // 円
  targetCount:     number   // 対象人数
  metric:          string   // 関連 KPI
}

export interface DailyTodoResult {
  todos:       DailyTodo[]
  totalExpect: number
  generatedAt: string
}

// ─── ルールベース TODO 生成 ───────────────────────────────────────────────────

export function generateDailyTodos(
  customers:    CustomerRow[],
  impactItems:  ImpactItem[],
  avgSpend:     number,
  avgProduct:   number,
): DailyTodoResult {
  const todos: DailyTodo[] = []

  // ① 次回予約未取得の離脱リスク顧客へフォロー
  const noRebookRisk = customers.filter(
    c => !c.hasNextRebook && c.churnRisk >= 40
  ).slice(0, 5)
  if (noRebookRisk.length > 0) {
    todos.push({
      rank:            1,
      action:          `次回予約未取得 ${noRebookRisk.length}名へLINEフォロー`,
      detail:          noRebookRisk.slice(0, 3).map(c => `${c.name.split(/\s/)[0]}様`).join('・') +
                       (noRebookRisk.length > 3 ? ' ほか' : ''),
      expectedRevenue: noRebookRisk.length * avgSpend,
      targetCount:     noRebookRisk.length,
      metric:          'nextReserveRate',
    })
  }

  // ② 店販提案: ハーブピーリング等の施術履歴あり未購入顧客
  const PRODUCT_TARGETS = ['ハーブピーリング', 'プレミアムエイジングケア', 'ホワイトニングケア']
  const productCandidates = customers.filter(
    c => c.treatments.some(t => PRODUCT_TARGETS.includes(t)) && c.lastVisit <= 14
  ).slice(0, 5)
  if (productCandidates.length > 0) {
    const names = productCandidates.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')
    todos.push({
      rank:            2,
      action:          `${productCandidates[0].treatments.find(t => PRODUCT_TARGETS.includes(t)) ?? '施術'}顧客に店販提案`,
      detail:          names + (productCandidates.length > 3 ? ' ほか' : ''),
      expectedRevenue: productCandidates.length * avgProduct,
      targetCount:     productCandidates.length,
      metric:          'retailRate',
    })
  }

  // ③ VIP候補（visitCount >= 6）への上位コース提案
  const vipCandidates = customers.filter(
    c => !c.isVip && c.visitCount >= 6 && c.churnRisk < 40
  ).slice(0, 3)
  if (vipCandidates.length > 0) {
    todos.push({
      rank:            3,
      action:          `VIP候補 ${vipCandidates.length}名へ来店提案`,
      detail:          vipCandidates.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・'),
      expectedRevenue: vipCandidates.length * Math.round(avgSpend * 1.5),
      targetCount:     vipCandidates.length,
      metric:          'vipRate',
    })
  }

  // 足りない場合はインパクト上位からフィルバック
  if (todos.length < 3 && impactItems.length > 0) {
    const existing = new Set(todos.map(t => t.metric))
    for (const item of impactItems) {
      if (todos.length >= 3) break
      if (existing.has(item.metric)) continue
      todos.push({
        rank:            todos.length + 1,
        action:          `${item.label}の改善（推奨アクション）`,
        detail:          item.recommendation,
        expectedRevenue: Math.round(item.estimatedMonthlyImpact / 4),   // 月次 ÷ 4週
        targetCount:     0,
        metric:          item.metric,
      })
      existing.add(item.metric)
    }
  }

  // rank を振り直し
  todos.forEach((t, i) => { t.rank = i + 1 })

  const totalExpect = todos.reduce((s, t) => s + t.expectedRevenue, 0)

  return { todos, totalExpect, generatedAt: new Date().toISOString() }
}

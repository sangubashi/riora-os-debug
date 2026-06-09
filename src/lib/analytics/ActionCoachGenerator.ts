/**
 * ActionCoachGenerator.ts  — Phase 3
 *
 * SuccessPattern + CustomerRow + StaffKPI を入力に
 * スタッフごとの「今日やること」CoachTask を生成する。
 *
 * 設計:
 *   - 外部 API 不使用・純粋関数
 *   - DEMO_MODE 対応
 *   - priority を HIGH / MEDIUM / LOW の3段階で返す
 */

import type { SuccessPattern, StaffBehaviorMetrics } from './SuccessPatternAnalyzer'
import type { CustomerRow }   from '@/store/useCustomerStore'
import type { StaffRankItem } from '@/store/useKpiStore'

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export type CoachPriority = 'high' | 'medium' | 'low'

export interface CoachTask {
  staffName:      string
  priority:       CoachPriority
  title:          string
  reason:         string
  action:         string
  targetCount:    number          // 今日の対象人数
  targetNames:    string[]        // 対象顧客名リスト（最大3名）
  expectedImpact: number          // 月次期待インパクト（円）
  metric:         string          // 関連指標名
}

export interface CoachResult {
  tasks:       CoachTask[]        // priority 降順
  staffGroups: Record<string, CoachTask[]>  // スタッフ名 → タスクリスト
  topTask:     CoachTask | null
  generatedAt: string
}

// ─── 優先度スコア ─────────────────────────────────────────────────────────────

const PRIORITY_SCORE: Record<CoachPriority, number> = { high: 3, medium: 2, low: 1 }

function toPriority(impact: number, diffPct: number): CoachPriority {
  if (impact >= 30000 || diffPct >= 25) return 'high'
  if (impact >= 15000 || diffPct >= 12) return 'medium'
  return 'low'
}

// ─── 顧客フィルター ───────────────────────────────────────────────────────────

function getTargetCustomers(
  customers: CustomerRow[],
  staffName: string,
  metric:    string,
): CustomerRow[] {
  const mine = customers.filter(c =>
    c.staffName === staffName || c.staffName === staffName.split(/\s/)[0]
  )

  switch (metric) {
    case 'nextReserveRate':
      return mine.filter(c => !c.hasNextRebook && c.churnRisk < 70).slice(0, 5)
    case 'vipRate':
      return mine.filter(c => !c.isVip && c.visitCount >= 5).slice(0, 5)
    case 'lineResponseAvg':
      return mine.filter(c => c.lineResponseRate < 50 && c.lastVisit >= 21).slice(0, 5)
    case 'repeatRate':
      return mine.filter(c => c.visitCount <= 3 && c.lastVisit >= 28).slice(0, 5)
    default:
      return mine.slice(0, 5)
  }
}

// ─── タスク生成ロジック ───────────────────────────────────────────────────────

const METRIC_TASK: Record<string, {
  titleFn:  (count: number) => string
  actionFn: (topStaff: string, targets: CustomerRow[]) => string
  reasonFn: (diffPct: number, topStaff: string) => string
}> = {
  nextReserveRate: {
    titleFn:  (n) => `次回予約提案を${n}名へ`,
    actionFn: (top, targets) => {
      const names = targets.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')
      return `${names}に対し、施術終了10分前に「次回はいつ頃にしましょうか」と提案する。${top}の成功実績を参考に。`
    },
    reasonFn: (diff, top) => `${top}との次回予約率の差 ${diff}%。今日の施術で差を縮めるチャンス。`,
  },
  vipRate: {
    titleFn:  (n) => `VIP候補${n}名へ上位コース提案`,
    actionFn: (top, targets) => {
      const names = targets.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')
      return `${names}に対し、上位コースやオプションを自然な流れで案内する。${top}の育成実績を参考に。`
    },
    reasonFn: (diff, top) => `${top}との VIP化率の差 ${diff}%。継続来店顧客への提案強化で改善できます。`,
  },
  lineResponseAvg: {
    titleFn:  (n) => `LINE未返信${n}名へメッセージ送信`,
    actionFn: (top, targets) => {
      const names = targets.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')
      return `${names}へ美容アドバイス中心のメッセージを送る。キャンペーン文は避け、肌悩みへの寄り添い文に変更する。`
    },
    reasonFn: (diff, top) => `${top}との LINE 返信率の差 ${diff}%。メッセージ内容の工夫で改善可能。`,
  },
  repeatRate: {
    titleFn:  (n) => `初回・2回目顧客${n}名へフォロー`,
    actionFn: (top, targets) => {
      const names = targets.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')
      return `${names}に「お肌の調子はいかがですか？」と来店後フォローを行う。${top}の実績を参考にした早期接触。`
    },
    reasonFn: (diff, top) => `${top}とのリピート率の差 ${diff}%。初回来店後7日以内の接触が鍵。`,
  },
}

// ─── SuccessPattern から CoachTask を生成 ─────────────────────────────────────

function patternToTask(
  pattern:   SuccessPattern,
  customers: CustomerRow[],
): CoachTask | null {
  const cfg = METRIC_TASK[pattern.metric]
  if (!cfg) return null

  const targets = getTargetCustomers(customers, pattern.bottomStaff, pattern.metric)
  if (targets.length === 0) return null

  const priority = toPriority(pattern.expectedImpact, pattern.diffValue)

  return {
    staffName:      pattern.bottomStaff,
    priority,
    title:          cfg.titleFn(targets.length),
    reason:         cfg.reasonFn(pattern.diffValue, pattern.topStaff),
    action:         cfg.actionFn(pattern.topStaff, targets),
    targetCount:    targets.length,
    targetNames:    targets.slice(0, 3).map(c => c.name),
    expectedImpact: Math.round(pattern.expectedImpact / 4),  // 月次 ÷ 4週 = 週次
    metric:         pattern.metric,
  }
}

// ─── ImpactItem（ImprovementImpactCalculator）から CoachTask を生成 ─────────────

export interface ImpactItemLite {
  metric:                 string
  label:                  string
  diffPct:                number
  estimatedMonthlyImpact: number
  recommendation:         string
  priority:               string
}

function impactToTask(
  item:      ImpactItemLite,
  customers: CustomerRow[],
  staffRanking: StaffRankItem[],
): CoachTask[] {
  const tasks: CoachTask[] = []

  // 全スタッフに対して同じ改善タスクを生成（improvement は店全体の指標）
  for (const staff of staffRanking) {
    const shortName = staff.name.split(/\s/)[0]
    const targets   = getTargetCustomers(customers, shortName, item.metric)
    if (targets.length === 0) continue

    const priority = toPriority(item.estimatedMonthlyImpact, Math.abs(item.diffPct))

    tasks.push({
      staffName:      shortName,
      priority,
      title:          `${item.label}改善アクション`,
      reason:         `${item.label}が平均より${Math.abs(item.diffPct)}%低い。`,
      action:         item.recommendation,
      targetCount:    targets.length,
      targetNames:    targets.slice(0, 3).map(c => c.name),
      expectedImpact: Math.round(item.estimatedMonthlyImpact / staffRanking.length / 4),
      metric:         item.metric,
    })
  }
  return tasks
}

// ─── DEMO モック ──────────────────────────────────────────────────────────────

function buildDemoTasks(
  customers:    CustomerRow[],
  staffRanking: StaffRankItem[],
): CoachTask[] {
  const demo: CoachTask[] = []

  for (const staff of staffRanking) {
    const name = staff.name.split(/\s/)[0]
    const noRebook = customers.filter(c =>
      (c.staffName === name) && !c.hasNextRebook
    )
    const vipCand = customers.filter(c =>
      (c.staffName === name) && !c.isVip && c.visitCount >= 5
    )

    if (noRebook.length > 0) {
      demo.push({
        staffName:      name,
        priority:       'high',
        title:          `次回予約提案を${noRebook.length}名へ`,
        reason:         '鈴木との次回予約率の差 30%。今日の施術で差を縮めるチャンス。',
        action:         `${noRebook.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')}に対し、施術終了10分前に「次回はいつ頃にしましょうか」と提案する。`,
        targetCount:    noRebook.length,
        targetNames:    noRebook.slice(0, 3).map(c => c.name),
        expectedImpact: noRebook.length * 3500,
        metric:         'nextReserveRate',
      })
    }

    if (vipCand.length > 0) {
      demo.push({
        staffName:      name,
        priority:       'medium',
        title:          `VIP候補${vipCand.length}名へ上位コース提案`,
        reason:         'VIP化率を高めることで月次売上 +¥2.8万 の改善余地あり。',
        action:         `${vipCand.slice(0, 3).map(c => c.name.split(/\s/)[0] + '様').join('・')}に上位コースを自然な流れで案内する。`,
        targetCount:    vipCand.length,
        targetNames:    vipCand.slice(0, 3).map(c => c.name),
        expectedImpact: vipCand.length * 4200,
        metric:         'vipRate',
      })
    }
  }
  return demo
}

// ─── メイン生成関数 ───────────────────────────────────────────────────────────

export function generateCoachTasks(params: {
  patterns:     SuccessPattern[]
  customers:    CustomerRow[]
  staffRanking: StaffRankItem[]
  impactItems?: ImpactItemLite[]
  demoMode?:    boolean
}): CoachResult {
  const { patterns, customers, staffRanking, impactItems = [], demoMode = false } = params

  let tasks: CoachTask[] = demoMode
    ? buildDemoTasks(customers, staffRanking)
    : [
        ...patterns.flatMap(p => patternToTask(p, customers) ?? []),
        ...impactItems.flatMap(i => impactToTask(i, customers, staffRanking)),
      ]

  // 重複排除（同スタッフ × 同 metric は1件に絞る）
  const seen = new Set<string>()
  tasks = tasks.filter(t => {
    const key = `${t.staffName}:${t.metric}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // priority 降順 → expectedImpact 降順でソート
  tasks.sort((a, b) =>
    PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority] ||
    b.expectedImpact - a.expectedImpact
  )

  // スタッフ別グループ
  const staffGroups: Record<string, CoachTask[]> = {}
  for (const t of tasks) {
    if (!staffGroups[t.staffName]) staffGroups[t.staffName] = []
    staffGroups[t.staffName].push(t)
  }

  return {
    tasks,
    staffGroups,
    topTask:     tasks[0] ?? null,
    generatedAt: new Date().toISOString(),
  }
}

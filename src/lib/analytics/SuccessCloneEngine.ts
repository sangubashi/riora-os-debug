/**
 * SuccessCloneEngine.ts  — Phase 5
 *
 * 売上上位スタッフの成功行動を自動抽出し、
 * 下位スタッフへの具体的行動として移植する。
 *
 * パイプライン:
 *   StaffBehaviorMetrics → SuccessAction 抽出
 *   ActionStats（過去ログ）→ uplift / confidence を補正
 *   RevenueAttribution 実績 → 実売上で検証
 */

import type { StaffBehaviorMetrics } from './SuccessPatternAnalyzer'
import type { ActionStats }           from '@/store/useImprovementLogStore'

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export interface SuccessAction {
  id:               string
  action:           string        // 具体的行動テキスト
  metric:           string        // 関連 KPI キー
  uplift:           number        // 0〜1（改善率の期待値）
  confidence:       number        // 0〜1（データ信頼度）
  estimatedRevenue: number        // 月次期待インパクト（円）
  evidences:        string[]      // 根拠リスト
}

export interface SuccessClone {
  sourceStaff:    string              // 模倣元スタッフ
  targetStaff:    string              // 模倣先スタッフ
  successActions: SuccessAction[]     // 移植すべき行動リスト（priority 順）
  totalImpact:    number              // 全アクション実行時の月次インパクト合計
}

export interface SuccessCloneResult {
  clones:        SuccessClone[]      // ターゲットスタッフごとの clone 提案
  topActions:    SuccessAction[]     // 全スタッフ共通の成功行動ランキング
  generatedAt:   string
}

// ─── 成功行動テンプレート ─────────────────────────────────────────────────────

interface ActionTemplate {
  metric:   string
  action:   string
  evidenceFn: (src: StaffBehaviorMetrics, tgt: StaffBehaviorMetrics) => string[]
  upliftFn:   (diff: number) => number
  revenueFn:  (diff: number, avgSpend: number, visits: number) => number
}

const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    metric:   'nextReserveRate',
    action:   '施術終了10分前に「次回はいつ頃にしましょうか」と自然に次回予約を提案する',
    upliftFn: (d) => Math.min(0.9, d / 100),
    revenueFn:(d, spend, v) => Math.round((d / 100) * v * spend),
    evidenceFn:(src, tgt) => [
      `${src.staffName}の次回予約率 ${src.nextReserveRate}%（${tgt.staffName}より${src.nextReserveRate - tgt.nextReserveRate}%高い）`,
      `${src.staffName}担当顧客のリピート率が${src.repeatRate - tgt.repeatRate}%高い`,
    ],
  },
  {
    metric:   'vipRate',
    action:   'リピーター顧客に「今回のお肌の状態にはこちらのコースが特に効果的です」と上位コースを提案する',
    upliftFn: (d) => Math.min(0.85, d / 100),
    revenueFn:(d, spend, v) => Math.round((d / 100) * v * spend * 1.5),
    evidenceFn:(src, tgt) => [
      `${src.staffName}のVIP率 ${src.vipRate}%（${tgt.staffName}より${src.vipRate - tgt.vipRate}%高い）`,
      `${src.staffName}担当の平均 LINE 返信率 ${src.lineResponseAvg}%（関係性が深い）`,
    ],
  },
  {
    metric:   'lineResponseAvg',
    action:   '施術の感想と美容アドバイスを組み合わせたメッセージを送る（キャンペーン文は使わない）',
    upliftFn: (d) => Math.min(0.75, d / 100),
    revenueFn:(d, spend, v) => Math.round((d / 100) * v * spend * 0.6),
    evidenceFn:(src, tgt) => [
      `${src.staffName}担当顧客の LINE 返信率 ${src.lineResponseAvg}%（${tgt.staffName}より${src.lineResponseAvg - tgt.lineResponseAvg}%高い）`,
    ],
  },
  {
    metric:   'repeatRate',
    action:   '初回来店後7日以内に「お肌の調子はいかがですか？」と経過確認の連絡を入れる',
    upliftFn: (d) => Math.min(0.8, d / 100),
    revenueFn:(d, spend, v) => Math.round((d / 100) * v * spend),
    evidenceFn:(src, tgt) => [
      `${src.staffName}のリピート率 ${src.repeatRate}%（${tgt.staffName}より${src.repeatRate - tgt.repeatRate}%高い）`,
      `${src.staffName}担当の平均離脱リスクが${tgt.churnRiskAvg - src.churnRiskAvg}%低い`,
    ],
  },
]

// ─── confidence 補正（ActionStats の実績を使う） ──────────────────────────────

function calcConfidence(
  baseConfidence: number,
  metric:         string,
  stats:          ActionStats[],
): number {
  const metricToAction: Record<string, string> = {
    nextReserveRate: 'rebook_proposal',
    vipRate:         'vip_upgrade',
    lineResponseAvg: 'line_follow',
    repeatRate:      'rebook_proposal',
  }
  const actionType = metricToAction[metric]
  const stat = stats.find(s => s.actionType === actionType)

  if (!stat || stat.totalCount < 3) return baseConfidence

  // 実績の成功率で confidence を補正（50% weight）
  const empirical = stat.successRate / 100
  return Math.round((baseConfidence * 0.5 + empirical * 0.5) * 100) / 100
}

// ─── 1 ターゲットスタッフへの SuccessClone 生成 ───────────────────────────────

function buildClone(
  source:   StaffBehaviorMetrics,
  target:   StaffBehaviorMetrics,
  stats:    ActionStats[],
  avgSpend: number,
  visits:   number,
): SuccessClone {
  const actions: SuccessAction[] = []

  for (const tpl of ACTION_TEMPLATES) {
    const srcVal = source[tpl.metric as keyof StaffBehaviorMetrics] as number
    const tgtVal = target[tpl.metric as keyof StaffBehaviorMetrics] as number
    const diff   = srcVal - tgtVal

    if (diff < 8) continue   // 差分 8% 未満は提案しない

    const uplift    = tpl.upliftFn(diff)
    const revenue   = tpl.revenueFn(diff, avgSpend, visits)
    const baseConf  = Math.min(0.95, 0.5 + diff / 100)
    const confidence = calcConfidence(baseConf, tpl.metric, stats)

    actions.push({
      id:               `${source.staffName}-${tpl.metric}`,
      action:           tpl.action,
      metric:           tpl.metric,
      uplift,
      confidence,
      estimatedRevenue: revenue,
      evidences:        tpl.evidenceFn(source, target),
    })
  }

  // estimatedRevenue 降順
  actions.sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)

  return {
    sourceStaff:    source.staffName,
    targetStaff:    target.staffName,
    successActions: actions,
    totalImpact:    actions.reduce((s, a) => s + a.estimatedRevenue, 0),
  }
}

// ─── topActions（全スタッフ共通成功行動ランキング） ────────────────────────────

function buildTopActions(
  source:   StaffBehaviorMetrics,
  stats:    ActionStats[],
  avgSpend: number,
  visits:   number,
): SuccessAction[] {
  return ACTION_TEMPLATES.map(tpl => {
    const metricVal = source[tpl.metric as keyof StaffBehaviorMetrics] as number
    const revenue   = tpl.revenueFn(20, avgSpend, visits)   // 差分20%を基準に計算
    const baseConf  = 0.75
    const confidence = calcConfidence(baseConf, tpl.metric, stats)
    return {
      id:               `top-${tpl.metric}`,
      action:           tpl.action,
      metric:           tpl.metric,
      uplift:           0.2,
      confidence,
      estimatedRevenue: revenue,
      evidences:        [`${source.staffName}の${tpl.metric}が全体トップ（${metricVal}%）`],
    }
  }).sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)
}

// ─── DEMO モック ──────────────────────────────────────────────────────────────

export function buildDemoClones(
  avgSpend: number,
  visits:   number,
): SuccessCloneResult {
  const actions: SuccessAction[] = [
    {
      id: 'top-nextReserveRate', action: '施術終了10分前に「次回はいつ頃にしましょうか」と自然に次回予約を提案する',
      metric: 'nextReserveRate', uplift: 0.32, confidence: 0.88,
      estimatedRevenue: Math.round(0.32 * visits * avgSpend),
      evidences: ['鈴木の次回予約率92%（全体平均より22%高い）', '高LTV顧客比率が1.4倍'],
    },
    {
      id: 'top-vipRate', action: 'リピーター顧客に上位コースを段階的に提案する',
      metric: 'vipRate', uplift: 0.24, confidence: 0.76,
      estimatedRevenue: Math.round(0.24 * visits * avgSpend * 1.5),
      evidences: ['亀山のVIP率38%（全体平均より23%高い）'],
    },
    {
      id: 'top-lineResponseAvg', action: '美容アドバイス中心のLINEメッセージを送る',
      metric: 'lineResponseAvg', uplift: 0.18, confidence: 0.71,
      estimatedRevenue: Math.round(0.18 * visits * avgSpend * 0.6),
      evidences: ['鈴木担当顧客のLINE返信率72%（全体平均より12%高い）'],
    },
  ]

  const clones: SuccessClone[] = [
    {
      sourceStaff: '鈴木', targetStaff: '外舘',
      successActions: [actions[0], actions[1]],
      totalImpact: actions[0].estimatedRevenue + actions[1].estimatedRevenue,
    },
    {
      sourceStaff: '鈴木', targetStaff: '亀山',
      successActions: [actions[2]],
      totalImpact: actions[2].estimatedRevenue,
    },
  ]

  return { clones, topActions: actions, generatedAt: new Date().toISOString() }
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export function runSuccessCloneEngine(params: {
  staffMetrics: StaffBehaviorMetrics[]
  actionStats:  ActionStats[]
  avgSpend:     number
  monthlyVisits: number
  demoMode?:    boolean
}): SuccessCloneResult {
  const { staffMetrics, actionStats, avgSpend, monthlyVisits, demoMode } = params

  if (demoMode || staffMetrics.length < 2) {
    return buildDemoClones(avgSpend, monthlyVisits)
  }

  const sorted = [...staffMetrics].sort((a, b) => b.totalSales - a.totalSales)
  const source = sorted[0]   // トップスタッフ
  const others = sorted.slice(1)

  const clones: SuccessClone[] = others
    .map(target => buildClone(source, target, actionStats, avgSpend, monthlyVisits))
    .filter(c => c.successActions.length > 0)
    .sort((a, b) => b.totalImpact - a.totalImpact)

  const topActions = buildTopActions(source, actionStats, avgSpend, monthlyVisits)

  return { clones, topActions, generatedAt: new Date().toISOString() }
}

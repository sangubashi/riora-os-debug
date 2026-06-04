/**
 * scoreActionPriority.ts
 * NextAction のスコアリングと優先度付け。
 * 純粋関数。副作用なし。テスト容易。
 */

import type { NextAction, NextActionPriority } from '@/types'
import { ACTION_RULES, type ActionRuleInput } from './actionRules'

// ─── 優先度しきい値 ───────────────────────────────────────────────────────────

const PRIORITY_THRESHOLD: Record<NextActionPriority, number> = {
  high:   75,
  medium: 45,
  low:     0,
}

function scoreToPriority(score: number): NextActionPriority {
  if (score >= PRIORITY_THRESHOLD.high)   return 'high'
  if (score >= PRIORITY_THRESHOLD.medium) return 'medium'
  return 'low'
}

// ─── スコアリング実行 ─────────────────────────────────────────────────────────

export interface ScoredNextAction extends NextAction {
  ruleId: string
}

export function scoreNextActions(input: ActionRuleInput): ScoredNextAction[] {
  const results: ScoredNextAction[] = []

  for (const rule of ACTION_RULES) {
    try {
      if (!rule.match(input)) continue

      const score    = Math.max(0, Math.min(100, rule.score(input)))
      const priority = scoreToPriority(score)

      results.push({
        id:          `${rule.id}_${input.customerId}`,
        type:        rule.type,
        priority,
        score,
        title:       rule.title(input),
        description: rule.desc(input),
        ctaLabel:    rule.ctaLabel,
        logType:     rule.logType,
        reasons:     rule.reasons ? rule.reasons(input) : undefined,
        ruleId:      rule.id,
      })
    } catch (e) {
      // ルール評価エラーは無視してスキップ
      console.warn(`[NextAction] rule ${rule.id} error:`, e)
    }
  }

  // スコア降順でソート
  return results.sort((a, b) => b.score - a.score)
}

// ─── 重複排除（同タイプは最高スコアのみ残す） ────────────────────────────────

export function deduplicateByType(actions: ScoredNextAction[]): ScoredNextAction[] {
  const seen = new Set<string>()
  return actions.filter(a => {
    if (seen.has(a.type)) return false
    seen.add(a.type)
    return true
  })
}

// ─── 優先度バッジ表示色（既存UIカラーに準拠） ────────────────────────────────

export const PRIORITY_STYLE: Record<NextActionPriority, {
  bg:    string
  color: string
  border: string
  label: string
}> = {
  high:   { bg: '#FFF0F2', color: '#C05060', border: 'rgba(192,80,96,0.25)',  label: '優先' },
  medium: { bg: '#FFFBF0', color: '#A07020', border: 'rgba(160,112,32,0.25)', label: '推奨' },
  low:    { bg: '#F8F5F0', color: '#9F7E6C', border: 'rgba(159,126,108,0.2)', label: '参考' },
}

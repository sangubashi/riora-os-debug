/**
 * generateNextActions.ts
 * NextAction のメイン生成関数。
 *
 * Supabase から必要データを収集し、
 * scoreNextActions で優先度付きアクションリストを返す。
 *
 * 将来: Edge Function 化で Server-side 実行も可能な設計。
 */

import { supabase, DEMO_MODE } from '@/lib/supabase'
import { stableQuery, prodLog } from '@/lib/stability'
import { scoreNextActions, deduplicateByType } from './scoreActionPriority'
import type { ActionRuleInput } from './actionRules'
import type { NextAction } from '@/types'
import type { SkinTagKey, InsightTag } from '@/types'
import { getMenuCycleDays } from '@/lib/homecare/generateHomecarePlan'

// ─── 入力（BottomSheet から渡される既存データ） ───────────────────────────────

export interface GenerateNextActionsInput {
  customerId:           string
  /** Customer 型のフィールド（既にロード済みのもの） */
  visits:               number
  totalSales:           number
  lineResponseRate:     number
  vipRank:              number
  churnRisk:            number
  daysSinceLastVisit:   number
  skinTags:             SkinTagKey[]
  recommendedCycleDays?: number | null
  menuName:             string
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

/**
 * 顧客に対する NextAction を最大3件取得する。
 * Supabase から insight_tags・recent_actions・purchase_history を非同期取得。
 */
export async function generateNextActions(
  input: GenerateNextActionsInput,
  maxCount = 3
): Promise<NextAction[]> {
  const {
    customerId,
    visits,
    totalSales,
    lineResponseRate,
    vipRank,
    churnRisk,
    daysSinceLastVisit,
    skinTags,
    recommendedCycleDays,
    menuName,
  } = input

  // 推奨サイクル: 明示指定 > メニュー名から推定 > デフォルト35日
  const cycleDays = recommendedCycleDays ?? getMenuCycleDays(menuName)

  // ── 並列取得 ─────────────────────────────────────────────────────────────
  const [insightResult, actionResult, purchaseResult] = await Promise.allSettled([
    fetchInsightTags(customerId),
    fetchRecentActionTypes(customerId),
    fetchRecentPurchase(customerId),
  ])

  const insightTags:        string[] = insightResult.status      === 'fulfilled' ? insightResult.value      : []
  const recentActionTypes:  string[] = actionResult.status       === 'fulfilled' ? actionResult.value       : []
  const hasRecentPurchase:  boolean  = purchaseResult.status     === 'fulfilled' ? purchaseResult.value     : false

  // ── スコアリング入力を組み立て ────────────────────────────────────────────
  const ruleInput: ActionRuleInput = {
    customerId,
    visits,
    totalSales,
    lineResponseRate,
    vipRank,
    churnRisk,
    daysSinceLastVisit,
    recommendedCycleDays: cycleDays,
    skinTags:    skinTags as string[],
    insightTags,
    hasRecentPurchase,
    recentActionTypes,
  }

  const scored      = scoreNextActions(ruleInput)
  const deduplicated = deduplicateByType(scored)

  return deduplicated.slice(0, maxCount)
}

// ─── データ取得ヘルパー ───────────────────────────────────────────────────────

async function fetchInsightTags(customerId: string): Promise<InsightTag[]> {
  if (DEMO_MODE) return ['dry_skin', 'aging_care'] as InsightTag[]

  const result = await stableQuery<Array<{insight_tags: string[] | null}>>(
    async () => {
      const { data, error } = await supabase.from('voice_notes').select('insight_tags')
        .eq('customer_id', customerId).not('insight_tags', 'is', null)
        .order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return data ?? []
    },
    [],
    { label: 'fetchInsightTags', timeoutMs: 5000, maxAttempts: 2 }
  )
  const data = result

  // 全メモのタグを結合してユニーク化
  const allTags = data.flatMap(r => (r.insight_tags ?? []) as string[])
  return Array.from(new Set(allTags)) as InsightTag[]
}

async function fetchRecentActionTypes(customerId: string): Promise<string[]> {
  if (DEMO_MODE) return []

  // 直近30日のアクションタイプを取得
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('customer_action_logs')
    .select('action_type')
    .eq('customer_id', customerId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data.map(r => r.action_type as string)
}

async function fetchRecentPurchase(customerId: string): Promise<boolean> {
  if (DEMO_MODE) return false

  // 直近90日以内の商品購入があるか
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('customer_action_logs')
    .select('id')
    .eq('customer_id', customerId)
    .eq('action_type', 'product_purchased')
    .gte('created_at', since)
    .limit(1)

  if (error) return false
  return (data?.length ?? 0) > 0
}

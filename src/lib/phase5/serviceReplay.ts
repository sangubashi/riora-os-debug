/**
 * serviceReplay.ts  — PHASE 5
 * 接客ログ・アクション履歴から「良かった点・改善点・提案タイミング評価」を生成。
 * AIを前に出さず、スタッフへの自然なフィードバックとして表示。
 */

import type { ServiceReplay } from '@/types'
import { supabase } from '@/lib/supabase'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface ServiceReplayInput {
  reservationId:     string | null
  customerId:        string
  actionsDoneToday:  string[]   // BottomSheet で押した action_type[]
  logsDoneToday:     string[]   // 接客ログ（ai_adopted / next_reserved 等）
  menuName:          string
  churnRisk:         number
  daysSinceLastVisit: number
}

// ─── リプレイ生成 ─────────────────────────────────────────────────────────────

export function buildServiceReplay(input: ServiceReplayInput): ServiceReplay {
  const {
    actionsDoneToday, logsDoneToday, menuName,
    churnRisk, daysSinceLastVisit,
  } = input

  const strengths:   string[] = []
  const suggestions: string[] = []

  // ── 強み分析 ────────────────────────────────────────────────────────────
  if (actionsDoneToday.includes('line_sent') || actionsDoneToday.includes('next_action_line')) {
    strengths.push('LINE送信でフォロー体制を整えました')
  }
  if (actionsDoneToday.includes('homecare_explained') || actionsDoneToday.includes('next_action_homecare')) {
    strengths.push('ホームケア説明で再来動機を強化しました')
  }
  if (actionsDoneToday.includes('rebook_recommended') || actionsDoneToday.includes('next_action_rebook')) {
    strengths.push('次回来店を提案しリピートに繋げました')
  }
  if (actionsDoneToday.includes('product_purchased')) {
    strengths.push('商品購入が確定。ホームケアの継続につながります')
  }
  if (logsDoneToday.includes('ai_adopted')) {
    strengths.push('AIアドバイスを活用した接客ができました')
  }
  if (logsDoneToday.includes('next_reserved')) {
    strengths.push('次回予約の取得に成功しました 🎉')
  }

  // ── 改善提案 ────────────────────────────────────────────────────────────
  if (!actionsDoneToday.some(t => t.includes('line'))) {
    suggestions.push('次回はLINEフォローも忘れずに（接触頻度が上がります）')
  }
  if (!actionsDoneToday.some(t => t.includes('rebook') || t.includes('next_action_rebook'))) {
    if (churnRisk >= 50) suggestions.push('離脱リスクがあるため次回来店提案を優先しましょう')
    else suggestions.push('次回来店の提案を加えると再来率が上がります')
  }
  if (!actionsDoneToday.some(t => t.includes('homecare'))) {
    suggestions.push(`${menuName}の効果を持続させるホームケア説明が効果的です`)
  }

  // 空の場合のフォールバック
  if (strengths.length === 0) {
    strengths.push('お客様と向き合った接客ができました')
  }

  // ── タイミング評価 ────────────────────────────────────────────────────────
  const timing = daysSinceLastVisit >= 30
    ? '久しぶりの来店なので、丁寧なヒアリングから入れていれば理想的でした'
    : daysSinceLastVisit <= 14
    ? '定期来店のお客様。施術に集中しながら次回提案を入れるタイミングを作れると◎'
    : '来店周期がちょうど良いタイミング。提案が入りやすい状態でした'

  // ── 流れ評価 ─────────────────────────────────────────────────────────────
  const completedCount = actionsDoneToday.length + logsDoneToday.length
  const flow = completedCount >= 4
    ? '接客フローが充実しています。この調子を続けましょう'
    : completedCount >= 2
    ? '基本的な接客フローが完了しています'
    : '記録が少なめです。次回は接客後にログを残す習慣を作りましょう'

  return { strengths, suggestions, timing, flow }
}

// ─── 接客ログ取得（本日分） ───────────────────────────────────────────────────

export async function fetchTodayLogs(
  customerId: string,
  reservationId: string | null
): Promise<string[]> {
  const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()

  const query = supabase
    .from('staff_logs')
    .select('ai_adopted, next_reserved, option_sold, retail_sold, churn_followed')
    .eq('customer_id', customerId)
    .gte('created_at', since)

  if (reservationId) query.eq('reservation_id', reservationId)

  const { data } = await query.limit(1).single()
  if (!data) return []

  const done: string[] = []
  if (data.ai_adopted)    done.push('ai_adopted')
  if (data.next_reserved) done.push('next_reserved')
  if (data.option_sold)   done.push('option_sold')
  if (data.retail_sold)   done.push('retail_sold')
  if (data.churn_followed) done.push('churn_followed')
  return done
}

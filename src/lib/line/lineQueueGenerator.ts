/**
 * lineQueueGenerator.ts  v2
 *
 * 追加条件:
 *   - 前回来店からの日数（lastVisit / recommendedCycle推定）
 *   - LINE返信率
 *   - voice insight（購入傾向・NGワード）
 *   - 優先度スコア100点満点
 *   - priorityScore順でキュー登録
 *   - 理由テキストを triggered_by に保存
 */

import { supabase, DEMO_MODE }          from '@/lib/supabase'
import { generateLineMessages }          from '@/lib/line/lineMessageGenerator'
import { generateInsightsFromNotes }     from '@/lib/voiceInsight/InsightGenerator'
import type { CustomerRow }              from '@/store/useCustomerStore'
import type { LineSendQueue }            from '@/types'

// ─── 定数 ────────────────────────────────────────────────────────────────────

const STORAGE_KEY        = 'riora_line_queue_last_run'
const RECOMMENDED_CYCLE  = 30    // recommended_cycle_days が取れない場合のデフォルト（日）
const PRODUCT_TRIGGERS   = ['ハーブピーリング', 'ホワイトニングケア', 'プレミアムエイジングケア']

// ─── 型 ──────────────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  customer:      CustomerRow
  priorityScore: number        // 0〜100
  reasons:       string[]      // 人間可読の理由リスト
  messageType:   string        // churn_prevention / vip_nurture 等
  insight:       ReturnType<typeof generateInsightsFromNotes> | null
}

export interface QueueGenerateResult {
  created:    number
  skipped:    number
  errors:     string[]
  candidates: ScoredCandidate[]
}

// ─── 1日1回ガード ─────────────────────────────────────────────────────────────

export function shouldRunToday(): boolean {
  if (DEMO_MODE) return true
  if (typeof window === 'undefined') return false
  const last  = localStorage.getItem(STORAGE_KEY)
  const today = new Date().toISOString().slice(0, 10)
  return last !== today
}

function markRanToday(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, new Date().toISOString().slice(0, 10))
}

// ─── 優先度スコア算出（100点満点） ───────────────────────────────────────────

export function calcPriorityScore(
  c:       CustomerRow,
  insight: ReturnType<typeof generateInsightsFromNotes> | null,
): { score: number; reasons: string[]; messageType: string } {
  let score = 0
  const reasons: string[] = []

  // ① churnRisk（最大35点）
  if (c.churnRisk >= 80)      { score += 35; reasons.push(`離脱リスク ${c.churnRisk}%（緊急）`) }
  else if (c.churnRisk >= 60) { score += 25; reasons.push(`離脱リスク ${c.churnRisk}%（高）`) }
  else if (c.churnRisk >= 40) { score += 12; reasons.push(`離脱リスク ${c.churnRisk}%（中）`) }

  // ② 来店間隔超過（最大25点）
  const cycle   = RECOMMENDED_CYCLE
  const overdue = c.lastVisit - cycle   // 超過日数
  if (overdue >= 30)      { score += 25; reasons.push(`来店間隔 ${c.lastVisit}日（${overdue}日超過）`) }
  else if (overdue >= 14) { score += 15; reasons.push(`来店間隔 ${c.lastVisit}日（推奨超過）`) }
  else if (overdue >= 0)  { score +=  5; reasons.push(`来店間隔 ${c.lastVisit}日（そろそろ）`) }

  // ③ LINE返信率（最大20点）
  // 返信率が高い→メッセージが届きやすい→送る価値が高い
  if (c.lineResponseRate >= 70)       { score += 20; reasons.push(`LINE返信率 ${c.lineResponseRate}%（高）`) }
  else if (c.lineResponseRate >= 40)  { score += 10; reasons.push(`LINE返信率 ${c.lineResponseRate}%`) }
  else if (c.lineResponseRate < 20)   {              reasons.push(`LINE返信率 ${c.lineResponseRate}%（低：文面要工夫）`) }

  // ④ 次回予約なし（+10点）
  if (!c.hasNextRebook) {
    score += 10
    reasons.push('次回予約未取得')
  }

  // ⑤ VIP候補（+8点）
  if (c.isVip || c.visitCount >= 8) {
    score += 8
    reasons.push(c.isVip ? 'VIP顧客' : `来店 ${c.visitCount}回（VIP候補）`)
  }

  // ⑥ 施術履歴（店販提案対象）（+5点）
  const hasProductTrigger = c.treatments.some(t => PRODUCT_TRIGGERS.includes(t))
  if (hasProductTrigger) {
    score += 5
    reasons.push(`施術履歴: ${c.treatments.filter(t => PRODUCT_TRIGGERS.includes(t))[0]}`)
  }

  // ⑦ voice insight: 購入傾向（+4点 / 傾向があれば）
  if (insight?.buyTendencies && insight.buyTendencies.length > 0) {
    score += 4
    reasons.push(`購入傾向: ${insight.buyTendencies[0].style}`)
  }

  // ⑧ voice insight: NGワードあり（-5点：慎重に）
  const hasNg = insight?.ngAlerts && insight.ngAlerts.some(n => n.severity === 'warn')
  if (hasNg) {
    score -= 5
    reasons.push(`注意: ${insight!.ngAlerts.filter(n => n.severity === 'warn')[0].topic}`)
  }

  // ⑨ voice insight: 次回提案（+3点）
  if (insight?.suggestions && insight.suggestions.length > 0) {
    score += 3
    reasons.push(`次回提案候補: ${insight.suggestions[0].treatment}`)
  }

  // スコアを 0〜100 にクランプ
  score = Math.max(0, Math.min(100, score))

  // メッセージタイプ決定
  const messageType = (() => {
    if (c.churnRisk >= 60 || overdue >= 14) return 'churn_prevention'
    if (c.isVip || c.visitCount >= 8)       return 'vip_nurture'
    if (hasProductTrigger)                   return 'product_suggest'
    return 'revisit'
  })()

  return { score, reasons, messageType }
}

// ─── 対象候補かどうか（最低条件） ────────────────────────────────────────────

function isCandidate(c: CustomerRow): boolean {
  if (c.churnRisk >= 40)                                     return true
  if (c.lastVisit >= RECOMMENDED_CYCLE)                      return true
  if (c.isVip || c.visitCount >= 8)                          return true
  if (c.treatments.some(t => PRODUCT_TRIGGERS.includes(t))) return true
  if (!c.hasNextRebook && c.visitCount >= 2)                 return true
  return false
}

// ─── 重複チェック ─────────────────────────────────────────────────────────────

async function alreadyQueuedToday(customerId: string, today: string): Promise<boolean> {
  // LINE キューは実データを扱うため、DEMO_MODE に関わらず実テーブルで重複チェックする
  const { data } = await supabase
    .from('line_send_queue')
    .select('id')
    .eq('customer_id', customerId)
    .gte('created_at', `${today}T00:00:00+09:00`)
    .in('status', ['pending', 'approved'])
    .limit(1)
    .maybeSingle()
  return !!data
}

// ─── voice_notes から insight 取得 ───────────────────────────────────────────

async function fetchInsight(customerId: string) {
  if (DEMO_MODE) return null
  const { data } = await supabase
    .from('voice_notes')
    .select('transcript, summary, insight_tags')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(3)
  if (!data || data.length === 0) return null
  return generateInsightsFromNotes(data)
}

// ─── LINE userId 取得 ─────────────────────────────────────────────────────────

async function getLineUserId(customerId: string): Promise<string | null> {
  // LINE キューは実データを扱うため、DEMO_MODE に関わらず実テーブルを参照する
  const { data } = await supabase
    .from('line_user_ids')
    .select('line_user_id')
    .eq('customer_id', customerId)
    .is('unfollowed_at', null)
    .maybeSingle()
  return data?.line_user_id ?? null
}

// ─── メイン生成関数 ───────────────────────────────────────────────────────────

export async function generateQueueForCustomers(
  customers: CustomerRow[]
): Promise<QueueGenerateResult> {
  if (!shouldRunToday()) {
    return { created: 0, skipped: customers.length, errors: [], candidates: [] }
  }

  const today   = new Date().toISOString().slice(0, 10)
  let   created = 0
  let   skipped = 0
  const errors:     string[]           = []
  const candidates: ScoredCandidate[]  = []

  // ① 候補絞り込み + insight 取得 + スコア算出
  const filtered = customers.filter(isCandidate)

  for (const c of filtered) {
    const insight                      = await fetchInsight(c.id)
    const { score, reasons, messageType } = calcPriorityScore(c, insight)
    candidates.push({ customer: c, priorityScore: score, reasons, messageType, insight })
  }

  // ② priorityScore 降順でソート
  candidates.sort((a, b) => b.priorityScore - a.priorityScore)

  // ③ キュー登録
  for (const candidate of candidates) {
    const { customer: c, priorityScore, reasons, messageType, insight } = candidate
    try {
      const duplicate = await alreadyQueuedToday(c.id, today)
      if (duplicate) { skipped++; continue }

      const lineUserId = await getLineUserId(c.id)
      if (!lineUserId) { skipped++; continue }

      // スコアが低すぎる候補はスキップ（10点未満）
      if (priorityScore < 10) { skipped++; continue }

      const result = generateLineMessages({
        customerName:   c.name,
        visitCount:     c.visitCount,
        totalSpent:     c.totalSpent,
        churnRisk:      c.churnRisk,
        vipRank:        c.isVip ? 3 : 0,
        daysSinceVisit: c.lastVisit,
        nextActionType: messageType,
        insight,
      })

      const msg = result.recommended
      // triggered_by に理由テキストを保存
      const triggeredBy = `score:${priorityScore} / ${reasons.slice(0, 3).join(' / ')}`

      const queueItem: Omit<LineSendQueue,
        'id' | 'created_at' | 'updated_at' | 'status' |
        'approved_by' | 'approved_at' | 'sent_at' | 'error_message'
      > = {
        customer_id:   c.id,
        customer_name: c.name,
        line_user_id:  lineUserId,
        message_body:  msg.message_body,
        send_mode:     'semi',
        scheduled_at:  null,
        triggered_by:  triggeredBy,
        template_id:   messageType,
      }

      if (DEMO_MODE) {
        const { useLineSendQueueStore } = await import('@/store/useLineSendQueueStore')
        await useLineSendQueueStore.getState().addToQueue(queueItem)
      } else {
        const { error } = await supabase
          .from('line_send_queue')
          .insert({ ...queueItem, status: 'pending' })
        if (error) throw new Error(error.message)
      }

      created++
    } catch (e) {
      errors.push(`[${c.name}] ${String(e)}`)
    }
  }

  if (created > 0) markRanToday()
  return { created, skipped, errors, candidates }
}

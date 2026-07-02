/**
 * GET /api/customers/[id]/timeline — AI Timeline (TL-1 Phase 1)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 * 担当顧客以外は 403、管理者は全件可。
 *
 * データソース:
 *   1. brain_visits           — 来店履歴
 *   2. voice_notes            — 音声メモ (analysis_status='completed')
 *   3. customer_memories      — Customer Memory
 *   4. brain_pattern_fire_log — AI 提案履歴
 *   ※ LINE 履歴は line_send_logs ↔ line_user_ids ↔ customers 間の
 *     スキーマ差異(brain_customers.id ≠ customers.id)により Phase 1 除外。
 *     "存在する場合" の扱いとして設計書差分に記載。
 *
 * 返却: { success, timeline: TimelineEntry[], aiSummary, talkingPoints }
 *   時系列降順(occurred_at DESC)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import type { MemoryType } from '@/types/customerMemory'
import { MEMORY_TYPE_EMOJI, MEMORY_TYPE_LABELS } from '@/types/customerMemory'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

export interface TimelineEntry {
  id: string
  type: 'visit' | 'voice' | 'memory' | 'line' | 'proposal'
  title: string
  content: string | null
  occurred_at: string
}

export interface TalkingPoint {
  emoji: string
  text: string
}

/** Phase 1 簡易版: Customer Memory + 音声メモ要約から決定論的生成。LLM 不使用。 */
function generateAISummary(
  visitCount: number,
  recentVoiceSummary: string | null,
  topMemories: Array<{ content: string }>
): string {
  const parts: string[] = []
  if (topMemories.length > 0) {
    parts.push(topMemories[0].content)
  }
  if (topMemories.length > 1) {
    parts.push(topMemories[1].content)
  }
  if (recentVoiceSummary) {
    const brief = recentVoiceSummary.length > 50
      ? recentVoiceSummary.slice(0, 50) + '…'
      : recentVoiceSummary
    parts.push(`前回の音声メモ: ${brief}`)
  }
  if (visitCount > 0) {
    parts.push(`累計 ${visitCount} 回来店`)
  }
  return parts.length > 0 ? parts.join('。') + '。' : '記録がまだありません。接客後に音声メモや記憶を追加すると表示されます。'
}

/** Customer Memory から today の接客ポイントを抽出(importance 降順・最大5件)。 */
function buildTalkingPoints(
  memories: Array<{ content: string; memory_type: string; importance: string }>
): TalkingPoint[] {
  const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
  return [...memories]
    .sort((a, b) => (ORDER[a.importance] ?? 2) - (ORDER[b.importance] ?? 2))
    .slice(0, 5)
    .map(m => ({
      emoji: MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝',
      text: m.content,
    }))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()

  // 4 データソースを並列取得
  const [visitsRes, voiceRes, memoriesRes, proposalsRes] = await Promise.allSettled([
    supabase
      .from('brain_visits')
      .select('id, visit_date, visit_count_at, treatment_amount, retail_amount')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(30),

    supabase
      .from('voice_notes')
      .select('id, created_at, summary')
      .eq('customer_id', customerId)
      .eq('analysis_status', 'completed')
      .order('created_at', { ascending: false })
      .limit(20),

    supabase
      .from('customer_memories')
      .select('id, created_at, content, memory_type, importance')
      .eq('customer_id', customerId)
      .eq('store_id', STORE_ID)
      .order('created_at', { ascending: false })
      .limit(20),

    supabase
      .from('brain_pattern_fire_log')
      .select('id, created_at, explanation')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const entries: TimelineEntry[] = []

  // 1. brain_visits → TimelineEntry
  const visits = visitsRes.status === 'fulfilled' ? (visitsRes.value.data ?? []) : []
  for (const v of visits) {
    const total = (v.treatment_amount ?? 0) + (v.retail_amount ?? 0)
    entries.push({
      id: `visit-${v.id}`,
      type: 'visit',
      title: `来店 ${v.visit_count_at}回目`,
      content: total > 0 ? `¥${total.toLocaleString('ja-JP')}` : null,
      occurred_at: `${v.visit_date as string}T00:00:00.000Z`,
    })
  }

  // 2. voice_notes → TimelineEntry
  const voiceNotes = voiceRes.status === 'fulfilled' ? (voiceRes.value.data ?? []) : []
  for (const n of voiceNotes) {
    entries.push({
      id: `voice-${n.id}`,
      type: 'voice',
      title: '音声メモ',
      content: (n.summary as string | null) ?? null,
      occurred_at: n.created_at as string,
    })
  }

  // 3. customer_memories → TimelineEntry
  const memories = memoriesRes.status === 'fulfilled' ? (memoriesRes.value.data ?? []) : []
  for (const m of memories) {
    const typeLabel = MEMORY_TYPE_LABELS[m.memory_type as MemoryType] ?? m.memory_type
    entries.push({
      id: `memory-${m.id}`,
      type: 'memory',
      title: `記憶 — ${typeLabel}`,
      content: m.content as string,
      occurred_at: m.created_at as string,
    })
  }

  // 4. brain_pattern_fire_log → TimelineEntry (AI 提案)
  const proposals = proposalsRes.status === 'fulfilled' ? (proposalsRes.value.data ?? []) : []
  for (const p of proposals) {
    const explanation = p.explanation as string
    entries.push({
      id: `proposal-${p.id}`,
      type: 'proposal',
      title: 'AI 提案',
      content: explanation || null,
      occurred_at: p.created_at as string,
    })
  }

  // 時系列降順
  entries.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))

  // AIまとめ(Phase 1 簡易版)
  const recentVoiceSummary = voiceNotes[0]?.summary as string | null ?? null
  const highImportanceMemories = memories
    .filter(m => m.importance === 'high' || m.importance === 'medium')
    .slice(0, 2) as Array<{ content: string; memory_type: string; importance: string }>
  const aiSummary = generateAISummary(visits.length, recentVoiceSummary, highImportanceMemories)

  // 今日の接客ポイント
  const talkingPoints = buildTalkingPoints(
    memories as Array<{ content: string; memory_type: string; importance: string }>
  )

  return NextResponse.json({ success: true, timeline: entries, aiSummary, talkingPoints })
}

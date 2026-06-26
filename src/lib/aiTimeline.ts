/**
 * aiTimeline.ts
 * 顧客の来店・LINE・音声・アクション履歴を
 * 統合タイムライン形式で取得する。
 *
 * 既存テーブル（customer_action_logs / voice_notes）から生成。
 * 新テーブル不要。
 */

import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { fetchVoiceNotes } from '@/lib/voiceNote'
import { ACTION_TYPE_LABELS } from '@/types'
import type { TimelineEvent, ActionType } from '@/types'

// ─── DEMO_MODE 用ダミーデータ ─────────────────────────────────────────────────

const DEMO_TIMELINE: TimelineEvent[] = [
  {
    id:         'demo-t1',
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    kind:       'action',
    label:      'ホームケア説明',
    detail:     '次回来店も提案済み',
    icon:       '⚡',
  },
  {
    id:         'demo-t2',
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    kind:       'line',
    label:      'LINE送信',
    detail:     '既読・返信あり',
    icon:       '💬',
  },
  {
    id:         'demo-t3',
    created_at: new Date(Date.now() - 42 * 86400000).toISOString(),
    kind:       'voice',
    label:      '音声メモ',
    detail:     '乾燥・エイジングについて',
    icon:       '🎙️',
  },
  {
    id:         'demo-t4',
    created_at: new Date(Date.now() - 42 * 86400000).toISOString(),
    kind:       'action',
    label:      '次回来店を提案',
    icon:       '⚡',
  },
]


// ─── アイコンマッピング ───────────────────────────────────────────────────────

const KIND_ICON: Record<TimelineEvent['kind'], string> = {
  visit:   '🏠',
  line:    '💬',
  product: '🛍',
  voice:   '🎙️',
  insight: '🧠',
  action:  '⚡',
}

// action_type → kind へのマッピング
function actionTypeToKind(type: string): TimelineEvent['kind'] {
  if (type === 'line_sent' || type === 'next_action_line') return 'line'
  if (type === 'product_recommended' || type === 'product_purchased' || type === 'next_action_product') return 'product'
  return 'action'
}

// ─── タイムライン取得 ─────────────────────────────────────────────────────────

export async function fetchCustomerTimeline(
  customerId: string,
  limit = 12
): Promise<TimelineEvent[]> {
  // DEMO_MODE: Supabase を呼ばずダミーデータを返す（VOICE_NOTES_LIVE時は実データへ進む）
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return DEMO_TIMELINE.slice(0, limit)

  console.log('[TIMELINE_FETCH]', { customerId })

  // customer_action_logs と voice_notes（Voice Notes一覧と同じデータソース）を並列取得
  const [logsResult, voiceNotes] = await Promise.allSettled([
    supabase
      .from('customer_action_logs')
      .select('id, action_type, action_payload, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit),

    fetchVoiceNotes(customerId, limit),
  ])

  const events: TimelineEvent[] = []

  // action_logs → TimelineEvent（voice_* は voice_notes 側で表示するため除外）
  if (logsResult.status === 'fulfilled' && logsResult.value.data) {
    for (const row of logsResult.value.data) {
      if (row.action_type === 'voice_note_created' || row.action_type === 'voice_insight_generated') continue
      const kind  = actionTypeToKind(row.action_type)
      const label = ACTION_TYPE_LABELS[row.action_type as ActionType] ?? row.action_type
      events.push({
        id:         row.id,
        created_at: row.created_at as string,
        kind,
        label,
        icon:       KIND_ICON[kind],
      })
    }
  }

  // voice_notes（解析完了済みのみ）→ TimelineEvent
  if (voiceNotes.status === 'fulfilled') {
    for (const note of voiceNotes.value) {
      if (note.analysis_status !== 'completed') continue
      events.push({
        id:           note.id,
        created_at:   note.created_at,
        kind:         'voice',
        label:        '音声メモ',
        detail:       note.summary ?? undefined,
        insight_tags: note.insight_tags,
        icon:         '🎙️',
      })
    }
  }

  // created_at 降順でソート・limit
  const result = events
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)

  console.log('[TIMELINE_RESULT]', {
    customerId,
    actionLogs:  logsResult.status === 'fulfilled' ? logsResult.value.data?.length : 'error',
    voiceNotes:  voiceNotes.status  === 'fulfilled' ? voiceNotes.value.length       : 'error',
    totalEvents: result.length,
  })

  return result
}

// ─── 表示用日時フォーマット ───────────────────────────────────────────────────

export function formatTimelineAt(iso: string): string {
  try {
    const d   = new Date(iso)
    const now = new Date()
    const diffMs   = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      const h   = String(d.getHours()).padStart(2, '0')
      const min = String(d.getMinutes()).padStart(2, '0')
      return `今日 ${h}:${min}`
    }
    if (diffDays === 1) return '昨日'
    if (diffDays < 180) return `${diffDays}日前`
    const m   = d.getMonth() + 1
    const day = d.getDate()
    return `${m}/${day}`
  } catch {
    return iso.slice(0, 10)
  }
}

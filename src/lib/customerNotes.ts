/**
 * customerNotes.ts
 * customer_notes テーブルの CRUD。
 * AI自動生成ノート（category != null）のみを対象とする。
 * 手動メモ（category = null）は CustomerBottomSheet の既存 saveMemo で管理。
 */

import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { prodLog } from '@/lib/stability'
import type { CustomerNote, NoteCategory } from '@/types'

export type { CustomerNote }

// ─── DEMO_MODE 用ダミーデータ ─────────────────────────────────────────────────

const DEMO_NOTES: CustomerNote[] = [
  {
    id:            'demo-cn-1',
    customer_id:   'demo',
    staff_id:      null,
    note:          '娘さんの誕生日に向けてきれいにしたいとのこと',
    category:      'Family',
    source:        'voice_note',
    voice_note_id: null,
    created_at:    new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id:            'demo-cn-2',
    customer_id:   'demo',
    staff_id:      null,
    note:          '仕事の残業が続いて肌の調子が悪いと話していた',
    category:      'Work',
    source:        'voice_note',
    voice_note_id: null,
    created_at:    new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id:            'demo-cn-3',
    customer_id:   'demo',
    staff_id:      null,
    note:          '乾燥と疲れが気になる。睡眠不足とのこと',
    category:      'Health',
    source:        'voice_note',
    voice_note_id: null,
    created_at:    new Date(Date.now() - 14 * 86400000).toISOString(),
  },
]

// ─── 取得 ─────────────────────────────────────────────────────────────────────

export async function fetchCustomerNotes(customerId: string): Promise<CustomerNote[]> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) {
    return DEMO_NOTES.filter(n => n.customer_id === 'demo')
  }

  const { data, error } = await supabase
    .from('customer_notes')
    .select('id, customer_id, staff_id, note, category, source, voice_note_id, created_at')
    .eq('customer_id', customerId)
    .not('category', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    prodLog('error', '[customerNotes] fetch failed', error.message)
    return []
  }
  return (data ?? []) as CustomerNote[]
}

// ─── AI保存（重複チェック付き） ───────────────────────────────────────────────

export async function saveAiCustomerNotes(params: {
  customerId:  string
  staffId:     string | null
  voiceNoteId: string
  notes:       Array<{ category: NoteCategory; content: string }>
}): Promise<void> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return
  if (params.notes.length === 0) return

  const { customerId, staffId, voiceNoteId, notes } = params

  // 既存ノート取得（同カテゴリの重複チェック用）
  const { data: existing } = await supabase
    .from('customer_notes')
    .select('category, note')
    .eq('customer_id', customerId)
    .not('category', 'is', null)

  // 先頭30文字をキーとして重複判定
  const existingSet = new Set<string>(
    (existing ?? []).map(r => `${r.category}:${(r.note as string).slice(0, 30)}`)
  )

  const toInsert = notes
    .filter(n => !existingSet.has(`${n.category}:${n.content.slice(0, 30)}`))
    .map(n => ({
      customer_id:   customerId,
      staff_id:      staffId,
      note:          n.content,
      category:      n.category,
      source:        'voice_note' as const,
      voice_note_id: voiceNoteId,
    }))

  if (toInsert.length === 0) {
    prodLog('info', '[customerNotes] 全件重複スキップ')
    return
  }

  const { error } = await supabase.from('customer_notes').insert(toInsert)
  if (error) {
    prodLog('error', '[customerNotes] save failed', error.message)
  } else {
    prodLog('info', `[customerNotes] ${toInsert.length}件保存完了`)
  }
}

// ─── 更新（スタッフによる手動編集） ─────────────────────────────────────────────

export async function updateCustomerNote(
  noteId: string,
  note:   string,
): Promise<{ error: string | null }> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return { error: null }

  const { error } = await supabase
    .from('customer_notes')
    .update({ note })
    .eq('id', noteId)

  if (error) return { error: error.message }
  return { error: null }
}

// ─── 削除 ─────────────────────────────────────────────────────────────────────

export async function deleteCustomerNote(noteId: string): Promise<{ error: string | null }> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return { error: null }

  const { error } = await supabase.from('customer_notes').delete().eq('id', noteId)
  if (error) return { error: error.message }
  return { error: null }
}

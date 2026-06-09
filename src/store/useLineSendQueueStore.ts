/**
 * useLineSendQueueStore.ts
 * LINE 送信キューの状態管理。
 * 実際の LINE userId / 送信結果を扱うため、グローバル DEMO_MODE に関わらず
 * 常に実 Supabase の line_send_queue を参照する。
 */
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { LineSendQueue, LineSendMode } from '@/types'

// ─── ストア型 ─────────────────────────────────────────────────────────────────

interface LineSendQueueState {
  queue:     LineSendQueue[]
  isLoading: boolean
  error:     string | null

  fetchQueue:      () => Promise<void>
  approveItem:     (id: string) => Promise<void>
  skipItem:        (id: string) => Promise<void>
  editMessage:     (id: string, body: string) => Promise<void>
  addToQueue:      (item: Omit<LineSendQueue, 'id' | 'created_at' | 'updated_at' | 'status' | 'approved_by' | 'approved_at' | 'sent_at' | 'error_message'>) => Promise<void>
}

// ─── ストア実装 ───────────────────────────────────────────────────────────────

export const useLineSendQueueStore = create<LineSendQueueState>((set, get) => ({
  queue:     [],
  isLoading: false,
  error:     null,

  fetchQueue: async () => {
    set({ isLoading: true, error: null })

    const { data, error } = await supabase
      .from('line_send_queue')
      .select('*')
      .in('status', ['pending', 'approved', 'sent', 'failed'])
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, isLoading: false })
      return
    }
    set({ queue: (data ?? []) as LineSendQueue[], isLoading: false })
  },

  approveItem: async (id: string) => {
    const res = await fetch('/api/line/approve', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, action: 'approve' }),
    })

    if (res.ok) await get().fetchQueue()
  },

  skipItem: async (id: string) => {
    const { error } = await supabase
      .from('line_send_queue')
      .update({ status: 'skipped' })
      .eq('id', id)

    if (!error) await get().fetchQueue()
  },

  editMessage: async (id: string, body: string) => {
    const { error } = await supabase
      .from('line_send_queue')
      .update({ message_body: body })
      .eq('id', id)

    if (!error) await get().fetchQueue()
  },

  addToQueue: async (item) => {
    await supabase.from('line_send_queue').insert({ ...item, status: 'pending' })
    await get().fetchQueue()
  },
}))

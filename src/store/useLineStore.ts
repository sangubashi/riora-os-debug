/**
 * useLineStore  –  LINE CRM 用 Zustand ストア
 *
 * ・Supabase から line_threads / line_messages / line_templates 等を取得
 * ・Realtime で新着メッセージを即時反映
 * ・モックデータへのフォールバック対応
 */
import { create } from 'zustand'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { CustomerType } from '@/types'

// ─── Re-export types (後方互換) ───────────────────────────────────────────────
export type { CustomerType }
export type MessageDirection = 'sent' | 'received'
export type MessageStatus    = 'delivered' | 'read' | 'failed'
export type AiReplyType      = 'revisit' | 'follow_up' | 'cancel_recovery' | 'vip'
export type LineCrmTab       = 'chat' | 'broadcast' | 'template'

export const SEGMENTS = ['全顧客', '1ヶ月以上未来店', 'VIP顧客', 'サブスク会員', '新規顧客'] as const
export type Segment = typeof SEGMENTS[number]

export interface LineThread {
  id:             string
  customerId:     string
  customerName:   string
  customerType:   CustomerType
  lastMessage:    string
  lastMessageAt:  string
  unreadCount:    number
  isUrgent:       boolean
  churnRisk:      number
  daysSinceVisit: number
  tags:           string[]
}

export interface LineMessage {
  id:        string
  threadId:  string
  direction: MessageDirection
  body:      string
  sentAt:    string
  status:    MessageStatus
}

export interface AiReplySuggestion {
  id:     string
  type:   AiReplyType
  body:   string
  reason: string
}

export interface TodayContact {
  customerId:     string
  customerName:   string
  reason:         string
  urgency:        'high' | 'medium' | 'low'
  daysSinceVisit: number
  threadId:       string
}

export interface LineTemplate {
  id:        string
  title:     string
  body:      string
  tags:      string[]
  usedCount?: number
}

// ─── Mock data (AI返信案フォールバックのみ。チャット一覧の初期表示には使わない) ──────
// PHASE LINE-MOCK-HIDE-1: 実機検証で「サンプル顧客A/B/C」「今日の対応が必要」
// 「未返信4件」等の架空データが、実際の緊急対応事項のようにスタッフ画面へ表示される
// ことが判明したため、threads/todayContactsの初期値・フォールバックとしては
// 一切使用しない(下記storeのthreads/todayContacts初期値を参照)。

const MOCK_AI: Record<string, AiReplySuggestion[]> = {
  'th-001': [
    { id:'ai1', type:'cancel_recovery', reason:'キャンセルフォロー', body:'サンプル顧客A様、ご連絡ありがとうございます。またご都合の良い日程をお知らせいただければ、お席をご用意いたします🌸 ご不明な点がございましたらお気軽にご相談ください。' },
    { id:'ai2', type:'follow_up',       reason:'代替日程提案',      body:'サンプル顧客A様、かしこまりました。来週でしたら空きがございます。またのご来店を心よりお待ちしております✨' },
  ],
  'th-003': [
    { id:'ai5', type:'vip',     reason:'VIP様特別案内',    body:'サンプル顧客C様、いつもご来店ありがとうございます✨ 新しいエイジングケアコースが入荷いたしました。いかがでしょうか？' },
    { id:'ai6', type:'revisit', reason:'施術後5日フォロー', body:'サンプル顧客C様、先日はご来店ありがとうございました🌸 施術後のお肌の調子はいかがでしょうか？次回は1ヶ月後頃がおすすめです。' },
  ],
}

let msgCounter = 200

// ─── Store ────────────────────────────────────────────────────────────────────

interface LineStore {
  // data
  threads:       LineThread[]
  messages:      LineMessage[]
  aiSuggestions: AiReplySuggestion[]
  todayContacts: TodayContact[]
  templates:     LineTemplate[]

  // ui
  activeTab:       LineCrmTab
  selectedThread:  LineThread | null
  isChatOpen:      boolean
  isBroadcastOpen: boolean
  isTemplateOpen:  boolean

  // broadcast
  broadcastBody:     string
  broadcastSegments: Segment[]
  broadcastSchedule: 'now' | 'tomorrow' | 'custom'
  broadcastCustomAt: string

  // async
  isLoading: boolean
  error:     string | null

  // realtime
  messageChannel: RealtimeChannel | null

  // ── Actions ────────────────────────────────────────────────────
  setTab:               (tab: LineCrmTab)    => void
  openThread:           (t: LineThread)      => void
  closeChat:            ()                   => void
  openBroadcast:        ()                   => void
  closeBroadcast:       ()                   => void
  openTemplate:         ()                   => void
  closeTemplate:        ()                   => void
  setBroadcastBody:     (b: string)          => void
  toggleSegment:        (s: Segment)         => void
  setBroadcastSchedule: (s: 'now' | 'tomorrow' | 'custom') => void
  setBroadcastCustomAt: (a: string)          => void

  // ── Supabase methods ───────────────────────────────────────────
  fetchThreads:     ()                       => Promise<void>
  fetchMessages:    (threadId: string)       => Promise<void>
  fetchTemplates:   ()                       => Promise<void>
  sendMessage:      (body: string)           => Promise<void>
  sendBroadcast:    ()                       => Promise<void>
  saveTemplate:     (t: Omit<LineTemplate,'id'|'usedCount'>) => Promise<void>

  subscribeMessages:   (threadId: string)    => void
  unsubscribeMessages: ()                    => void
}

export const useLineStore = create<LineStore>((set, get) => ({
  threads:       [],
  messages:      [],
  aiSuggestions: [],
  todayContacts: [],
  templates:     [],

  activeTab:       'chat',
  selectedThread:  null,
  isChatOpen:      false,
  isBroadcastOpen: false,
  isTemplateOpen:  false,

  broadcastBody:     '',
  broadcastSegments: [],
  broadcastSchedule: 'now',
  broadcastCustomAt: '',

  isLoading:      false,
  error:          null,
  messageChannel: null,

  // ── UI actions ─────────────────────────────────────────────────
  setTab: (tab) => set({ activeTab: tab }),

  openThread: (thread) => {
    set({
      selectedThread: thread,
      isChatOpen:     true,
      aiSuggestions:  MOCK_AI[thread.id] ?? [],
    })
    get().fetchMessages(thread.id)
    get().subscribeMessages(thread.id)
  },

  closeChat: () => {
    get().unsubscribeMessages()
    set({ isChatOpen: false })
  },

  openBroadcast:        () => set({ isBroadcastOpen: true }),
  closeBroadcast:       () => set({ isBroadcastOpen: false }),
  openTemplate:         () => { get().fetchTemplates(); set({ isTemplateOpen: true }) },
  closeTemplate:        () => set({ isTemplateOpen: false }),
  setBroadcastBody:     (b)  => set({ broadcastBody: b }),
  toggleSegment:        (s)  => set(st => ({
    broadcastSegments: st.broadcastSegments.includes(s)
      ? st.broadcastSegments.filter(x => x !== s)
      : [...st.broadcastSegments, s],
  })),
  setBroadcastSchedule: (s) => set({ broadcastSchedule: s }),
  setBroadcastCustomAt: (a) => set({ broadcastCustomAt: a }),

  // ── fetchThreads ────────────────────────────────────────────────
  fetchThreads: async () => {
    if (DEMO_MODE) return
    set({ isLoading: true })
    try {
      const { data, error } = await supabase
        .from('line_threads')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(50)

      if (error || !data || data.length === 0) { set({ isLoading: false }); return }

      set({
        threads: data.map((r: {
          id: string; customer_id: string; customer_name: string; customer_type: CustomerType;
          last_message: string; last_message_at: string; unread_count: number;
          is_urgent: boolean; churn_risk: number; days_since_visit: number; tags: string[]
        }) => ({
          id:             r.id,
          customerId:     r.customer_id,
          customerName:   r.customer_name,
          customerType:   r.customer_type,
          lastMessage:    r.last_message,
          lastMessageAt:  r.last_message_at,
          unreadCount:    r.unread_count,
          isUrgent:       r.is_urgent,
          churnRisk:      r.churn_risk,
          daysSinceVisit: r.days_since_visit,
          tags:           r.tags ?? [],
        })),
      })
    } catch { /* fallback */ } finally {
      set({ isLoading: false })
    }
  },

  // ── fetchMessages ────────────────────────────────────────────────
  fetchMessages: async (threadId) => {
    if (DEMO_MODE) return
    try {
      const { data } = await supabase
        .from('line_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('sent_at', { ascending: true })
        .limit(100)

      if (data && data.length > 0) {
        set({ messages: data.map((r: {
          id: string; thread_id: string; direction: MessageDirection; body: string;
          sent_at: string; status: MessageStatus
        }) => ({
          id:        r.id,
          threadId:  r.thread_id,
          direction: r.direction,
          body:      r.body,
          sentAt:    r.sent_at,
          status:    r.status,
        }))})
      }
    } catch { /* fallback: messages stay empty */ }
  },

  // ── fetchTemplates ────────────────────────────────────────────────
  fetchTemplates: async () => {
    if (DEMO_MODE) return
    try {
      const { data, error } = await supabase
        .from('line_templates')
        .select('id, title, body, tags, use_count')
        .order('use_count', { ascending: false })
        .limit(20)

      if (error) console.error('[useLineStore] fetchTemplates failed:', error)

      if (data && data.length > 0) {
        set({ templates: data.map((r: {
          id: string; title: string; body: string; tags: string[]; use_count: number
        }) => ({
          id:        r.id,
          title:     r.title,
          body:      r.body,
          tags:      r.tags,
          usedCount: r.use_count,
        }))})
      }
    } catch { /* fallback */ }
  },

  // ── sendMessage ────────────────────────────────────────────────
  sendMessage: async (body) => {
    const { selectedThread } = get()
    if (!selectedThread || !body.trim()) return

    const optimistic: LineMessage = {
      id:        `msg-${++msgCounter}`,
      threadId:  selectedThread.id,
      direction: 'sent',
      body:      body.trim(),
      sentAt:    new Date().toISOString(),
      status:    'delivered',
    }

    set(s => ({
      messages: [...s.messages, optimistic],
      threads:  s.threads.map(t => t.id === selectedThread.id
        ? { ...t, lastMessage: body.trim(), lastMessageAt: optimistic.sentAt, unreadCount: 0 }
        : t),
    }))

    if (DEMO_MODE) return

    const { error } = await supabase.from('line_messages').insert({
      thread_id:   selectedThread.id,
      customer_id: selectedThread.customerId,
      direction:   'sent',
      body:        body.trim(),
      status:      'delivered',
      sent_at:     optimistic.sentAt,
    })

    if (error) {
      set(s => ({ messages: s.messages.filter(m => m.id !== optimistic.id) }))
    }
  },

  // ── sendBroadcast ─────────────────────────────────────────────
  sendBroadcast: async () => {
    const { broadcastBody, broadcastSegments } = get()
    if (!broadcastBody.trim() || !broadcastSegments.length) return
    set({ broadcastBody: '', broadcastSegments: [], isBroadcastOpen: false })
    if (DEMO_MODE) return
    const { broadcastSchedule, broadcastCustomAt } = get()
    const scheduledAt = broadcastSchedule === 'tomorrow'
      ? (() => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(10,0,0,0); return d.toISOString() })()
      : broadcastSchedule === 'custom' ? broadcastCustomAt
      : null
    await supabase.from('line_broadcasts').insert({
      body: broadcastBody.trim(), segment_names: broadcastSegments,
      status: scheduledAt ? 'scheduled' : 'sent',
      scheduled_at: scheduledAt, sent_at: scheduledAt ? null : new Date().toISOString(),
    })
  },

  // ── saveTemplate ─────────────────────────────────────────────
  saveTemplate: async (tmpl) => {
    if (DEMO_MODE) {
      set(s => ({ templates: [...s.templates, { id: `tmpl-${Date.now()}`, ...tmpl, usedCount: 0 }] }))
      return
    }
    const { data, error } = await supabase
      .from('line_templates')
      .insert({ title: tmpl.title, body: tmpl.body, tags: tmpl.tags })
      .select('id, title, body, tags, use_count')
      .single()
    if (error) console.error('[useLineStore] saveTemplate failed:', error)
    if (data) {
      set(s => ({ templates: [...s.templates, { id: data.id, title: data.title, body: data.body, tags: data.tags, usedCount: 0 }] }))
    }
  },

  // ── Realtime ─────────────────────────────────────────────────
  subscribeMessages: (threadId) => {
    if (DEMO_MODE) return
    get().unsubscribeMessages()
    const channel = supabase
      .channel(`line-messages-${threadId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'line_messages',
        filter: `thread_id=eq.${threadId}`,
      }, (payload) => {
        const r = payload.new as {
          id: string; thread_id: string; direction: MessageDirection; body: string;
          sent_at: string; status: MessageStatus
        }
        set(s => ({ messages: [...s.messages.filter(m => m.id !== r.id), {
          id: r.id, threadId: r.thread_id, direction: r.direction,
          body: r.body, sentAt: r.sent_at, status: r.status,
        }] }))
      })
      .subscribe()
    set({ messageChannel: channel })
  },

  unsubscribeMessages: () => {
    if (DEMO_MODE) return
    const ch = get().messageChannel
    if (ch) { supabase.removeChannel(ch); set({ messageChannel: null }) }
  },
}))

// backward-compat alias
export const useLineCrmStore = useLineStore

/**
 * useLineAdminStore.ts — LINE画面本物化(Pass G)の状態管理
 *
 * GET/POST/PATCH/DELETE /api/admin/line/* をfetchするだけ(モック・ダミーデータなし)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface LineThreadSummary {
  recipientId: string
  displayName: string | null
  customerId: string | null
  customerName: string | null
  isFollowing: boolean
  lastMessage: string
  lastDirection: 'incoming' | 'outgoing'
  lastAt: string
  messageCount: number
}

export interface LineThreadMessage {
  id: string
  message: string
  direction: 'incoming' | 'outgoing'
  status: string
  sentAt: string
}

export interface DeliveryHistoryItem {
  id: string
  customerName: string
  lineUserId: string
  messageBody: string
  status: string
  sendMode: string
  approvedAt: string | null
  sentAt: string | null
  errorMessage: string | null
  createdAt: string
}

export interface LineTemplateItem {
  id: string
  categoryId: string | null
  categoryName: string | null
  title: string
  body: string
  tags: string[]
  useCount: number
  isActive: boolean
  createdAt: string
}

interface LineAdminState {
  threads: LineThreadSummary[]
  isLoadingThreads: boolean
  threadsError: string | null

  activeMessages: LineThreadMessage[]
  isLoadingMessages: boolean
  messagesError: string | null

  history: DeliveryHistoryItem[]
  isLoadingHistory: boolean
  historyError: string | null

  templates: LineTemplateItem[]
  isLoadingTemplates: boolean
  templatesError: string | null

  fetchThreads: () => Promise<void>
  fetchThreadMessages: (recipientId: string) => Promise<void>
  fetchHistory: () => Promise<void>
  fetchTemplates: () => Promise<void>
  createTemplate: (input: { categoryId: string | null; title: string; body: string; tags: string[] }) => Promise<boolean>
  updateTemplate: (id: string, input: Partial<{ categoryId: string | null; title: string; body: string; tags: string[]; isActive: boolean }>) => Promise<boolean>
  deleteTemplate: (id: string) => Promise<boolean>
}

export const useLineAdminStore = create<LineAdminState>((set, get) => ({
  threads: [],
  isLoadingThreads: false,
  threadsError: null,

  activeMessages: [],
  isLoadingMessages: false,
  messagesError: null,

  history: [],
  isLoadingHistory: false,
  historyError: null,

  templates: [],
  isLoadingTemplates: false,
  templatesError: null,

  fetchThreads: async () => {
    set({ isLoadingThreads: true, threadsError: null })
    try {
      const res = await authedFetch('/api/admin/line/threads')
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ threadsError: body.error ?? 'fetch_failed', isLoadingThreads: false })
        return
      }
      set({ threads: body.threads, isLoadingThreads: false })
    } catch (e) {
      set({ threadsError: e instanceof Error ? e.message : 'fetch_failed', isLoadingThreads: false })
    }
  },

  fetchThreadMessages: async (recipientId) => {
    set({ isLoadingMessages: true, messagesError: null })
    try {
      const res = await authedFetch(`/api/admin/line/threads/${encodeURIComponent(recipientId)}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ messagesError: body.error ?? 'fetch_failed', isLoadingMessages: false })
        return
      }
      set({ activeMessages: body.messages, isLoadingMessages: false })
    } catch (e) {
      set({ messagesError: e instanceof Error ? e.message : 'fetch_failed', isLoadingMessages: false })
    }
  },

  fetchHistory: async () => {
    set({ isLoadingHistory: true, historyError: null })
    try {
      const res = await authedFetch('/api/admin/line/history')
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ historyError: body.error ?? 'fetch_failed', isLoadingHistory: false })
        return
      }
      set({ history: body.history, isLoadingHistory: false })
    } catch (e) {
      set({ historyError: e instanceof Error ? e.message : 'fetch_failed', isLoadingHistory: false })
    }
  },

  fetchTemplates: async () => {
    set({ isLoadingTemplates: true, templatesError: null })
    try {
      const res = await authedFetch('/api/admin/line/templates')
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ templatesError: body.error ?? 'fetch_failed', isLoadingTemplates: false })
        return
      }
      set({ templates: body.templates, isLoadingTemplates: false })
    } catch (e) {
      set({ templatesError: e instanceof Error ? e.message : 'fetch_failed', isLoadingTemplates: false })
    }
  },

  createTemplate: async (input) => {
    try {
      const res = await authedFetch('/api/admin/line/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ templatesError: body.error ?? 'create_failed' })
        return false
      }
      await get().fetchTemplates()
      return true
    } catch (e) {
      set({ templatesError: e instanceof Error ? e.message : 'create_failed' })
      return false
    }
  },

  updateTemplate: async (id, input) => {
    try {
      const res = await authedFetch(`/api/admin/line/templates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ templatesError: body.error ?? 'update_failed' })
        return false
      }
      await get().fetchTemplates()
      return true
    } catch (e) {
      set({ templatesError: e instanceof Error ? e.message : 'update_failed' })
      return false
    }
  },

  deleteTemplate: async (id) => {
    try {
      const res = await authedFetch(`/api/admin/line/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ templatesError: body.error ?? 'delete_failed' })
        return false
      }
      await get().fetchTemplates()
      return true
    } catch (e) {
      set({ templatesError: e instanceof Error ? e.message : 'delete_failed' })
      return false
    }
  },
}))

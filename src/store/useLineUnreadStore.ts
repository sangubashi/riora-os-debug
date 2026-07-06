import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export interface LineUnreadItem {
  recipientId: string
  name:        string
  lastMessage: string
  lastAt:      string
}

interface LineUnreadState {
  unreadCount: number
  unreads:     LineUnreadItem[]
  isLoading:   boolean
  fetchUnreads: () => Promise<void>
}

export const useLineUnreadStore = create<LineUnreadState>((set) => ({
  unreadCount: 0,
  unreads:     [],
  isLoading:   false,

  fetchUnreads: async () => {
    set({ isLoading: true })
    try {
      const res = await authedFetch('/api/admin/line/threads')
      if (!res.ok) return
      const data = await res.json()
      const threads = (data.threads ?? []) as Array<{
        recipientId:   string
        customerName:  string | null
        displayName:   string | null
        lastMessage:   string
        lastDirection: 'incoming' | 'outgoing'
        lastAt:        string
      }>
      const incoming = threads.filter(t => t.lastDirection === 'incoming')
      set({
        unreadCount: incoming.length,
        unreads: incoming.map(t => ({
          recipientId: t.recipientId,
          name:        t.customerName ?? t.displayName ?? t.recipientId,
          lastMessage: t.lastMessage,
          lastAt:      t.lastAt,
        })),
      })
    } catch {
      // silent: unreadCount stays 0
    } finally {
      set({ isLoading: false })
    }
  },
}))

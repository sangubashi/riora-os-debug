/**
 * useNotificationsStore — アプリ内通知v1(通知センター)の状態管理
 *
 * データ源: GET /api/notifications（JWT内スタッフIDで自動フィルタ、AUTH-2準拠）
 *
 * 既読状態はブラウザのメモリ上(このstate)のみで保持し、DBには保存しない
 * (notificationsテーブルを作らない設計のため)。ページを離れる/再読み込みすると
 * 既読状態は失われる。通知自体は都度の計算結果であり、条件に該当しなくなれば
 * 自然に一覧から消える(7日expireの代替)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { NotificationsResponse, StaffNotification } from '@/types/notifications'

interface NotificationsState {
  notifications: StaffNotification[]
  isLoading:     boolean
  error:         string | null
  readIds:       Set<string> // 画面内(メモリ)のみ。DBには保存しない

  fetchNotifications: () => Promise<void>
  markRead:  (id: string) => void
  unreadCount: () => number
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  isLoading:     false,
  error:         null,
  readIds:       new Set(),

  fetchNotifications: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await authedFetch('/api/notifications')
      const data = (await res.json()) as NotificationsResponse
      if (!res.ok || !data.success) {
        set({ error: data.error ?? `HTTP ${res.status}` })
        return
      }
      set({ notifications: data.notifications })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ isLoading: false })
    }
  },

  markRead: (id: string) => {
    set((state) => {
      const next = new Set(state.readIds)
      next.add(id)
      return { readIds: next }
    })
  },

  unreadCount: () => {
    const { notifications, readIds } = get()
    return notifications.filter((n) => !readIds.has(n.id)).length
  },
}))

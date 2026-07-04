/**
 * useTodayBriefingStore — 今日タブ「来店前30秒ブリーフィング」専用ストア
 *
 * データ源: GET /api/today-briefing（JWT内スタッフIDで自動フィルタ）
 */
import { create } from 'zustand'
import type { TodayBriefingResponse } from '@/types/todayBriefing'
import { authedFetch } from '@/lib/api/authedFetch'

interface TodayBriefingState {
  briefing:   TodayBriefingResponse | null
  isLoading:  boolean

  fetchTodayBriefing: () => Promise<void>
}

export const useTodayBriefingStore = create<TodayBriefingState>((set) => ({
  briefing:  null,
  isLoading: false,

  fetchTodayBriefing: async () => {
    set({ isLoading: true })
    try {
      const res = await authedFetch('/api/today-briefing')
      if (!res.ok) {
        console.warn('[TodayBriefingStore] API error:', res.status)
        return
      }
      const data = await res.json() as TodayBriefingResponse
      set({ briefing: data })
    } catch (e) {
      console.error('[TodayBriefingStore] fetchTodayBriefing error:', e)
    } finally {
      set({ isLoading: false })
    }
  },
}))

import { create } from 'zustand';
import { authedFetch } from '@/lib/api/authedFetch';

export interface MyStats {
  nominationDiff: number
  repeatRateDiff: number
  visitCountDiff: number
  reviewCount:    number | null
}

interface MyStatsState {
  stats:      MyStats | null
  isLoading:  boolean
  error:      string | null
  fetchStats: () => Promise<void>
}

export const useMyStatsStore = create<MyStatsState>((set) => ({
  stats:     null,
  isLoading: false,
  error:     null,

  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await authedFetch('/api/me/monthly-stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        stats: {
          nominationDiff: data.nominationDiff ?? 0,
          repeatRateDiff: data.repeatRateDiff ?? 0,
          visitCountDiff: data.visitCountDiff ?? 0,
          reviewCount:    data.reviewCount ?? null,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg, stats: null });
    } finally {
      set({ isLoading: false });
    }
  },
}));

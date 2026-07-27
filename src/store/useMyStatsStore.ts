import { create } from 'zustand';
import { authedFetch } from '@/lib/api/authedFetch';

export interface MetricDetail {
  thisMonth: number
  lastMonth: number
  diff:      number
  /** 増減率(%)。先月実績が0の場合は算出不能のためnull。 */
  pctChange: number | null
}

export interface MyStats {
  nominationDiff:  number
  repeatRateDiff:  number
  visitCountDiff:  number
  /** 先月比 店販売上(円)。今月・先月とも来店記録が無い場合はnull(「計測中」表示)。 */
  retailSalesDiff: number | null
  /** タップ時の詳細表示用(今月・先月実数)。APIで既に計算済みの値をそのまま保持する。 */
  nomination:  MetricDetail
  repeatRate:  MetricDetail
  visitCount:  MetricDetail
  retailSales: MetricDetail | null
}

interface MyStatsState {
  stats:            MyStats | null
  isLoading:        boolean
  error:            string | null
  /** 管理者アカウントでのアクセス等、対象外アカウントであることを示す(PHASE MYPAGE-1)。 */
  notStaffAccount:  boolean
  fetchStats:       () => Promise<void>
}

export const useMyStatsStore = create<MyStatsState>((set) => ({
  stats:            null,
  isLoading:        false,
  error:            null,
  notStaffAccount:  false,

  fetchStats: async () => {
    set({ isLoading: true, error: null, notStaffAccount: false });
    try {
      const res = await authedFetch('/api/me/monthly-stats');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error === 'admin_not_supported') {
          set({ notStaffAccount: true, stats: null });
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      set({
        stats: {
          nominationDiff:  data.nominationDiff ?? 0,
          repeatRateDiff:  data.repeatRateDiff ?? 0,
          visitCountDiff:  data.visitCountDiff ?? 0,
          retailSalesDiff: data.retailSalesDiff ?? null,
          nomination:  data.nomination,
          repeatRate:  data.repeatRate,
          visitCount:  data.visitCount,
          retailSales: data.retailSales ?? null,
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

/**
 * useKpiSqlStore – brain_visits / brain_staff ベース KPI ストア
 * /api/kpi/summary 経由で取得（service role により RLS bypass）。
 */
import { create } from 'zustand';

export interface WeeklySalesPoint {
  date:  string   // YYYY-MM-DD
  sales: number
}

export interface StaffPerf {
  staffId:    string
  staffName:  string
  visitCount: number
  totalSales: number
  nominations: number
}

export interface KpiSqlState {
  todaySales:      number
  monthlySales:    number
  nominationCount: number   // 今月の指名件数
  nextBookingRate: number   // 0–100 %
  staffPerformance: StaffPerf[]
  weeklySales:     WeeklySalesPoint[]
  isLoading:       boolean

  fetchAll: () => Promise<void>
}

export const useKpiSqlStore = create<KpiSqlState>((set) => ({
  todaySales:      0,
  monthlySales:    0,
  nominationCount: 0,
  nextBookingRate: 0,
  staffPerformance: [],
  weeklySales:     [],
  isLoading:       false,

  fetchAll: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/kpi/summary');
      if (!res.ok) return;
      const data = await res.json();
      set({
        todaySales:      data.todaySales      ?? 0,
        monthlySales:    data.monthlySales    ?? 0,
        nominationCount: data.nominationCount ?? 0,
        nextBookingRate: data.nextBookingRate  ?? 0,
        weeklySales:     data.weeklySales     ?? [],
        staffPerformance: data.staffPerformance ?? [],
      });
    } catch (e) {
      console.error('[KpiSqlStore] fetchAll:', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));

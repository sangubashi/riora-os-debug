/**
 * useKpiSqlStore – brain_visits / brain_customers ベース KPI ストア
 * /api/kpi/summary 経由（service role により RLS bypass）。
 * 認証不要・モックなし。
 */
import { create } from 'zustand';

export interface WeeklySalesPoint {
  date:  string   // YYYY-MM-DD
  sales: number
}

export interface StaffPerf {
  staffId:     string
  staffName:   string
  visitCount:  number
  totalSales:  number
  nominations: number
}

export interface KpiSqlState {
  todaySales:         number
  yesterdaySales:     number   // brain_visits 昨日分
  monthlySales:       number
  nominationCount:    number
  nextBookingRate:    number   // 0–100 %
  todayVisitCount:    number   // brain_visits 本日の来院件数
  churnRiskCount:     number   // 最終来院 >90日 or 来院なし の顧客数
  activeCustomerCount: number  // brain_customers アクティブ件数
  repeatRate:         number   // 0–100 % (過去365日2回以上来院)
  avgSpend:           number   // 円 (今月客単価)
  visitCycleDays:     number   // 日 (来院間隔平均)
  staffPerformance:   StaffPerf[]
  weeklySales:        WeeklySalesPoint[]
  isLoading:          boolean

  fetchAll: () => Promise<void>
}

export const useKpiSqlStore = create<KpiSqlState>((set) => ({
  todaySales:          0,
  yesterdaySales:      0,
  monthlySales:        0,
  nominationCount:     0,
  nextBookingRate:     0,
  todayVisitCount:     0,
  churnRiskCount:      0,
  activeCustomerCount: 0,
  repeatRate:          0,
  avgSpend:            0,
  visitCycleDays:      0,
  staffPerformance:    [],
  weeklySales:         [],
  isLoading:           false,

  fetchAll: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/kpi/summary');
      if (!res.ok) return;
      const data = await res.json();
      set({
        todaySales:          data.todaySales          ?? 0,
        yesterdaySales:      data.yesterdaySales      ?? 0,
        monthlySales:        data.monthlySales        ?? 0,
        nominationCount:     data.nominationCount     ?? 0,
        nextBookingRate:     data.nextBookingRate      ?? 0,
        todayVisitCount:     data.todayVisitCount     ?? 0,
        churnRiskCount:      data.churnRiskCount      ?? 0,
        activeCustomerCount: data.activeCustomerCount ?? 0,
        repeatRate:          data.repeatRate          ?? 0,
        avgSpend:            data.avgSpend            ?? 0,
        visitCycleDays:      data.visitCycleDays      ?? 0,
        weeklySales:         data.weeklySales         ?? [],
        staffPerformance:    data.staffPerformance    ?? [],
      });
    } catch (e) {
      console.error('[KpiSqlStore] fetchAll:', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));

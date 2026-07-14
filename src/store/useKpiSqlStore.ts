/**
 * useKpiSqlStore – brain_visits / brain_customers ベース KPI ストア
 * /api/kpi/summary 経由（service role により RLS bypass）。
 * 認証不要・モックなし。
 */
import { create } from 'zustand';
import { authedFetch } from '@/lib/api/authedFetch';

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
  // 店舗全体売上系(todaySales/yesterdaySales/monthlySales/weeklySales/avgSpend)は
  // AUTH-2aによりowner/管理者以外にはAPIがnullを返す(店舗全体の売上をスタッフ間の
  // 比較材料にしない方針)。nullは「非表示」であり0(売上ゼロ)ではない。
  todaySales:         number | null
  yesterdaySales:     number | null  // brain_visits 昨日分
  monthlySales:       number | null
  nominationCount:    number
  nextBookingRate:    number   // 0–100 %
  todayVisitCount:    number   // brain_visits 本日の来院件数
  churnRiskCount:     number   // 最終来院 >90日 or 来院なし の顧客数
  activeCustomerCount: number  // brain_customers アクティブ件数
  repeatRate:         number   // 0–100 % (過去365日2回以上来院)
  avgSpend:           number | null  // 円 (今月客単価)
  visitCycleDays:     number   // 日 (来院間隔平均)
  staffPerformance:   StaffPerf[]
  weeklySales:        WeeklySalesPoint[] | null
  isLoading:          boolean

  fetchAll: () => Promise<void>
}

export const useKpiSqlStore = create<KpiSqlState>((set) => ({
  todaySales:          null,
  yesterdaySales:      null,
  monthlySales:        null,
  nominationCount:     0,
  nextBookingRate:     0,
  todayVisitCount:     0,
  churnRiskCount:      0,
  activeCustomerCount: 0,
  repeatRate:          0,
  avgSpend:            null,
  visitCycleDays:      0,
  staffPerformance:    [],
  weeklySales:         null,
  isLoading:           false,

  fetchAll: async () => {
    set({ isLoading: true });
    try {
      const res = await authedFetch('/api/kpi/summary');
      if (!res.ok) return;
      const data = await res.json();
      set({
        todaySales:          data.todaySales          ?? null,
        yesterdaySales:      data.yesterdaySales      ?? null,
        monthlySales:        data.monthlySales        ?? null,
        nominationCount:     data.nominationCount     ?? 0,
        nextBookingRate:     data.nextBookingRate      ?? 0,
        todayVisitCount:     data.todayVisitCount     ?? 0,
        churnRiskCount:      data.churnRiskCount      ?? 0,
        activeCustomerCount: data.activeCustomerCount ?? 0,
        repeatRate:          data.repeatRate          ?? 0,
        avgSpend:            data.avgSpend            ?? null,
        visitCycleDays:      data.visitCycleDays      ?? 0,
        weeklySales:         data.weeklySales         ?? null,
        staffPerformance:    data.staffPerformance    ?? [],
      });
    } catch (e) {
      console.error('[KpiSqlStore] fetchAll:', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));

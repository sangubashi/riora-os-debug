import { describe, expect, it } from 'vitest';
import { DashboardRepo } from '../../../src/repositories/supabase/DashboardRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainDashboardRow } from '../../../src/repositories/supabase/mappers';

const DASHBOARD_ROW: BrainDashboardRow = {
  store_id: 'store-1',
  snapshot_date: '2026-06-12',
  monthly_sales: 1200000,
  forecast_sales: 1500000,
  breakeven_point: 900000,
  repeat_rate_90d: '0.42',
  rebooking_rate: '0.55',
  homecare_rate: '0.3',
  segment_matrix: { A_acne: 10 },
  funnel: { visited: 100, proposed: 50 },
  staff_matrix: { 'staff-1': { score: 0.8 } },
  ai_insights: [{ type: 'note', text: 'insight' }],
};

describe('DashboardRepo', () => {
  describe('latestByStore', () => {
    it('行が見つかった場合はDashboardSnapshotへ変換する', async () => {
      const { client } = createSingleTableSupabaseMock({ data: DASHBOARD_ROW, error: null });
      const repo = new DashboardRepo(client);

      const result = await repo.latestByStore('store-1');

      expect(result).toEqual({
        storeId: 'store-1',
        snapshotDate: '2026-06-12',
        monthlySales: 1200000,
        forecastSales: 1500000,
        breakevenPoint: 900000,
        repeatRate90d: 0.42,
        rebookingRate: 0.55,
        homecareRate: 0.3,
        segmentMatrix: { A_acne: 10 },
        funnel: { visited: 100, proposed: 50 },
        staffMatrix: { 'staff-1': { score: 0.8 } },
        aiInsights: [{ type: 'note', text: 'insight' }],
      });
    });

    it('行が見つからない場合はnullを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new DashboardRepo(client);

      const result = await repo.latestByStore('store-1');

      expect(result).toBeNull();
    });

    it('Supabaseがerrorを返した場合はDashboardRepo.latestByStore failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new DashboardRepo(client);

      await expect(repo.latestByStore('store-1')).rejects.toThrow('DashboardRepo.latestByStore failed: db down');
    });

    it('store_idでフィルタしsnapshot_date降順limit1で取得する', async () => {
      const builder = createQueryBuilderMock({ data: DASHBOARD_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new DashboardRepo(client);

      await repo.latestByStore('store-1');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.order).toHaveBeenCalledWith('snapshot_date', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(1);
    });

    it('repeat_rate_90d等がnullの場合はnullを保持する', async () => {
      const row: BrainDashboardRow = {
        ...DASHBOARD_ROW,
        repeat_rate_90d: null,
        rebooking_rate: null,
        homecare_rate: null,
        breakeven_point: null,
      };
      const { client } = createSingleTableSupabaseMock({ data: row, error: null });
      const repo = new DashboardRepo(client);

      const result = await repo.latestByStore('store-1');

      expect(result?.repeatRate90d).toBeNull();
      expect(result?.rebookingRate).toBeNull();
      expect(result?.homecareRate).toBeNull();
      expect(result?.breakevenPoint).toBeNull();
    });
  });
});

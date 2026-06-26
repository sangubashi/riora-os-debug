import { describe, expect, it, vi } from 'vitest';
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
  dm_to_booking_rate: '0.23',
  repeat_30: '0.5',
  repeat_60: '0.45',
  repeat_90: '0.4',
  new_ratio: '0.3',
  nomination_rate: '0.6',
  month_profit_est: -38000,
  visit_count: 18,
  vip_customer_ids: ['cust-1'],
  relation_triggers: { birthday: ['cust-1'] },
  occupancy: { mon: { '10': 0.5 } },
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
        dmToBookingRate: 0.23,
        repeat30: 0.5,
        repeat60: 0.45,
        repeat90: 0.4,
        newRatio: 0.3,
        nominationRate: 0.6,
        monthProfitEst: -38000,
        visitCount: 18,
        vipCustomerIds: ['cust-1'],
        relationTriggers: { birthday: ['cust-1'] },
        occupancy: { mon: { '10': 0.5 } },
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

  describe('listSinceDate', () => {
    it('複数行をDashboardSnapshot[]へ変換する', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [DASHBOARD_ROW], error: null });
      const repo = new DashboardRepo(client);

      const result = await repo.listSinceDate('store-1', '2026-06-01');

      expect(result).toHaveLength(1);
      expect(result[0].monthlySales).toBe(1200000);
    });

    it('行が無い場合は空配列を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new DashboardRepo(client);

      const result = await repo.listSinceDate('store-1', '2026-06-01');

      expect(result).toEqual([]);
    });

    it('store_id+snapshot_date>=fromDateでsnapshot_date昇順に取得する', async () => {
      const builder = createQueryBuilderMock({ data: [DASHBOARD_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new DashboardRepo(client);

      await repo.listSinceDate('store-1', '2026-06-01');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.gte).toHaveBeenCalledWith('snapshot_date', '2026-06-01');
      expect(builder.order).toHaveBeenCalledWith('snapshot_date', { ascending: true });
    });

    it('Supabaseがerrorを返した場合はDashboardRepo.listSinceDate failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new DashboardRepo(client);

      await expect(repo.listSinceDate('store-1', '2026-06-01'))
        .rejects.toThrow('DashboardRepo.listSinceDate failed: db down');
    });
  });

  describe('upsertDaily', () => {
    it('(store_id, snapshot_date)でUPSERTし、指定したKPI列のみをSETする', async () => {
      const builder = createQueryBuilderMock({ data: null, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new DashboardRepo(client);

      await repo.upsertDaily({
        storeId: 'store-1',
        snapshotDate: '2026-06-23',
        monthlySales: 1842000,
        forecastSales: 2210000,
        breakevenPoint: 2180000,
        monthProfitEst: -38000,
        visitCount: 32,
        repeat30: 0.5,
        repeat60: 0.45,
        repeat90: 0.4,
        nominationRate: 0.6,
      });

      expect(builder.upsert).toHaveBeenCalledWith(
        {
          store_id: 'store-1',
          snapshot_date: '2026-06-23',
          monthly_sales: 1842000,
          forecast_sales: 2210000,
          breakeven_point: 2180000,
          month_profit_est: -38000,
          visit_count: 32,
          repeat_30: 0.5,
          repeat_60: 0.45,
          repeat_90: 0.4,
          nomination_rate: 0.6,
        },
        { onConflict: 'store_id,snapshot_date' }
      );
    });

    it('Supabaseがerrorを返した場合はDashboardRepo.upsertDaily failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new DashboardRepo(client);

      await expect(repo.upsertDaily({
        storeId: 'store-1', snapshotDate: '2026-06-23', monthlySales: 0, forecastSales: 0,
        breakevenPoint: null, monthProfitEst: null, visitCount: 0,
        repeat30: null, repeat60: null, repeat90: null, nominationRate: null,
      })).rejects.toThrow('DashboardRepo.upsertDaily failed: db down');
    });

    it('aiInsightsを指定した場合はai_insights列もSETする(AI Warning Engine連携)', async () => {
      const builder = createQueryBuilderMock({ data: null, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new DashboardRepo(client);

      await repo.upsertDaily({
        storeId: 'store-1', snapshotDate: '2026-06-23', monthlySales: 0, forecastSales: 0,
        breakevenPoint: null, monthProfitEst: null, visitCount: 0,
        repeat30: null, repeat60: null, repeat90: null, nominationRate: null,
        aiInsights: [{ title: '失客予兆', message: 'テスト', severity: 'critical', targetCount: 1, actionType: 'contact_customer' }],
      });

      const [payload] = (builder.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(payload.ai_insights).toEqual([{ title: '失客予兆', message: 'テスト', severity: 'critical', targetCount: 1, actionType: 'contact_customer' }]);
    });

    it('aiInsightsを指定しない場合はai_insights列をSETしない(既存値を保持)', async () => {
      const builder = createQueryBuilderMock({ data: null, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new DashboardRepo(client);

      await repo.upsertDaily({
        storeId: 'store-1', snapshotDate: '2026-06-23', monthlySales: 0, forecastSales: 0,
        breakevenPoint: null, monthProfitEst: null, visitCount: 0,
        repeat30: null, repeat60: null, repeat90: null, nominationRate: null,
      });

      const [payload] = (builder.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
      expect('ai_insights' in payload).toBe(false);
    });
  });
});

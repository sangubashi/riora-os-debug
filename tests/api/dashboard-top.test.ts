import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/dashboard/top/route';
import { getRepos } from '../../app/lib/repos';
import type { DashboardSnapshot, BusinessSettings, OpsLog } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const SNAPSHOT: DashboardSnapshot = {
  storeId: 'store-1',
  snapshotDate: '2026-06-22',
  monthlySales: 1842000,
  forecastSales: 2210000,
  breakevenPoint: 2180000,
  repeatRate90d: 0.42,
  rebookingRate: 0.71,
  homecareRate: 0.3,
  segmentMatrix: {},
  funnel: {},
  staffMatrix: { 'staff-1': { sales: 999999 } },
  aiInsights: [{ type: 'churn_risk', text: '田中様 周期2.3倍・離脱圏 → 外舘に対応を指示' }],
  dmToBookingRate: 0.23,
  repeat30: 0.5,
  repeat60: 0.45,
  repeat90: 0.4,
  newRatio: 0.3,
  nominationRate: 0.6,
  monthProfitEst: -38000,
  visitCount: 32,
  vipCustomerIds: [],
  relationTriggers: {},
  occupancy: {},
};

const SETTINGS: BusinessSettings = {
  storeId: 'store-1',
  month: '2026-06-01',
  salesTarget: 2500000,
  fixedCosts: { rent: 437646 },
  variableCostRate: 0.25,
  seatCapacity: null,
  variableRates: null,
};

const CSV_LOG: OpsLog = {
  id: 'log-1',
  storeId: 'store-1',
  kind: 'csv_import',
  actorId: null,
  detail: { newCustomers: 3, updatedCustomers: 5, visitsImported: 8, unresolvedStaffCount: 1, piiFoundTotal: 0, durationMs: 120 },
  createdAt: '2026-06-21T10:00:00.000Z',
};

const mockRepos = {
  dashboardRepo: { latestByStore: vi.fn(), listSinceDate: vi.fn() },
  businessSettingsRepo: { findByStoreAndMonth: vi.fn() },
  visitRepo: { sumSalesByStoreAndDate: vi.fn() },
  opsLogRepo: { recentByStoreAndKind: vi.fn() },
};

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/dashboard/top${qs}`);
}

describe('GET /api/dashboard/top (GetDashboardTop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.dashboardRepo.latestByStore.mockResolvedValue(SNAPSHOT);
    mockRepos.dashboardRepo.listSinceDate.mockResolvedValue([SNAPSHOT]);
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(SETTINGS);
    mockRepos.visitRepo.sumSalesByStoreAndDate.mockResolvedValue(98000);
    mockRepos.opsLogRepo.recentByStoreAndKind.mockResolvedValue([CSV_LOG]);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('必須4指標を返す(今月売上/利益/損益分岐まで/着地予測)', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.required4).toEqual({
      monthlySales: 1842000,
      profit: -38000,
      breakevenPoint: 2180000,
      breakevenRemaining: 338000,
      forecastSales: 2210000,
      fixedCostsConfigured: true,
    });
  });

  it('固定費未設定(fixed_costs=null)の場合はprofit=nullを返す', async () => {
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue({ ...SETTINGS, fixedCosts: null });

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.required4.profit).toBeNull();
    expect(body.required4.fixedCostsConfigured).toBe(false);
  });

  it('business_settings行が存在しない場合もprofit=null・targetProgress=nullを返す', async () => {
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(null);

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.required4.profit).toBeNull();
    expect(body.kpi4.targetProgress).toBeNull();
    expect(body.kpi4.salesTarget).toBeNull();
  });

  it('KPI4を返す(本日売上/目標進捗/次回予約率/DM→予約転換率)・スタッフ関連フィールドを含まない', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.kpi4).toEqual({
      todaySales: 98000,
      targetProgress: 1842000 / 2500000,
      salesTarget: 2500000,
      rebookingRate: 0.71,
      dmToBookingRate: 0.23,
    });
    expect(body).not.toHaveProperty('staffMatrix');
    expect(body).not.toHaveProperty('staffRanking');
  });

  it('extendedKpi(来店人数/リピート率/指名率)をsnapshotから返す(KPI4枠には含まれない)', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.extendedKpi).toEqual({
      visitCount: 32,
      repeat30: 0.5,
      repeat60: 0.45,
      repeat90: 0.4,
      nominationRate: 0.6,
    });
  });

  it('今日の一手はsnapshot.aiInsightsをそのまま返す(LLM非呼出・決定論ルール由来)', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.todayActions).toEqual(SNAPSHOT.aiInsights);
  });

  it('売上推移はlistSinceDateの結果をsnapshotDate/monthlySales/forecastSalesのみで返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.salesTrend).toEqual([
      { snapshotDate: '2026-06-22', monthlySales: 1842000, forecastSales: 2210000 },
    ]);
  });

  it('dashboardRepo.listSinceDateを当月1日でフィルタして呼ぶ', async () => {
    await GET(buildUrl('?storeId=store-1&date=2026-06-22'));

    expect(mockRepos.dashboardRepo.listSinceDate).toHaveBeenCalledWith('store-1', '2026-06-01');
    expect(mockRepos.businessSettingsRepo.findByStoreAndMonth).toHaveBeenCalledWith('store-1', '2026-06-01');
    expect(mockRepos.visitRepo.sumSalesByStoreAndDate).toHaveBeenCalledWith('store-1', '2026-06-22');
  });

  it('CSV取込状況カードは最新ops_logから件数を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.csvImportStatus).toEqual({
      lastImportedAt: '2026-06-21T10:00:00.000Z',
      newCustomers: 3,
      updatedCustomers: 5,
      visitsImported: 8,
      unresolvedStaffCount: 1,
    });
  });

  it('CSV取込履歴が無い場合はcsvImportStatus=nullを返す', async () => {
    mockRepos.opsLogRepo.recentByStoreAndKind.mockResolvedValue([]);

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(body.csvImportStatus).toBeNull();
  });

  it('dashboard_dailyが0件(snapshot=null)でもゼロ値で正常応答する(空状態)', async () => {
    mockRepos.dashboardRepo.latestByStore.mockResolvedValue(null);
    mockRepos.dashboardRepo.listSinceDate.mockResolvedValue([]);

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.required4.monthlySales).toBe(0);
    expect(body.required4.breakevenPoint).toBeNull();
    expect(body.required4.breakevenRemaining).toBeNull();
    expect(body.todayActions).toEqual([]);
    expect(body.salesTrend).toEqual([]);
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));

    expect(res.status).toBe(500);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.dashboardRepo.latestByStore.mockRejectedValue(new Error('DashboardRepo.latestByStore failed: db down'));

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-22'));

    expect(res.status).toBe(500);
  });

  it('date未指定の場合はYYYY-MM-DD形式のサーバー現在日時を使う', async () => {
    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('dateが不正な形式の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026/06/22'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });
});

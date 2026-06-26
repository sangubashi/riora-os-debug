// ================================================================
// DashboardAggregator 検証
//
// computeDashboardAggregate()は純粋関数(DB/Supabase非依存)のため、構築した
// Visit[]を直接渡してKPI計算式(月売上MTD/着地予測/損益分岐/利益予測/来店人数/
// リピート率/指名率)を検証する。runDashboardAggregator()はrepos経由の
// オーケストレーション(取得→集計→upsertDaily呼び出し)のみをfakeで検証する。
// ================================================================
import { describe, expect, it, vi } from 'vitest';
import { computeDashboardAggregate, runDashboardAggregator, type DashboardAggregatorRepos } from '../../../src/lib/dashboard/DashboardAggregator';
import type { Visit, BusinessSettings, Customer, Staff, Subscription, DashboardSnapshot } from '../../../src/types/riora.types';

let visitSeq = 0;
function visit(opts: {
  customerId: string;
  visitDate: string;
  treatmentAmount?: number;
  retailAmount?: number;
  isNomination?: boolean;
}): Visit {
  visitSeq += 1;
  return {
    id: `visit-${visitSeq}`,
    storeId: 'store-1',
    customerId: opts.customerId,
    staffId: 'staff-1',
    menuId: 'menu-1',
    visitDate: opts.visitDate,
    visitCountAt: 1,
    isNomination: opts.isNomination ?? false,
    treatmentAmount: opts.treatmentAmount ?? 10000,
    retailAmount: opts.retailAmount ?? 0,
    retailCategory: null,
    homecarePurchased: false,
    homecareDeclined: false,
    nextBookingMade: false,
    noBookingReason: null,
    voiceMemoUrl: null,
    visitScore: 0,
  };
}

describe('computeDashboardAggregate', () => {
  it('当月(MTD)のtreatment+retailを合計しmonthly_salesを返す(前月の来店は含めない)', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20',
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-05-31', treatmentAmount: 99999 }), // 前月: 除外
        visit({ customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 10000, retailAmount: 2000 }),
        visit({ customerId: 'c2', visitDate: '2026-06-21', treatmentAmount: 99999 }), // snapshotDateより後: 除外
      ],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    expect(result.monthlySales).toBe(12000);
  });

  it('着地予測(forecast_sales)はMTD売上のランレート(MTD÷経過日数×当月日数)', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20', // 6月20日経過・6月は30日
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 40000 })],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    // 40000 / 20日 × 30日 = 60000
    expect(result.forecastSales).toBe(60000);
  });

  it('来店が0件の月はmonthly_sales/forecast_sales/visit_countが0、nomination_rate/repeatはnull', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20',
      visits: [],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    expect(result.monthlySales).toBe(0);
    expect(result.forecastSales).toBe(0);
    expect(result.visitCount).toBe(0);
    expect(result.nominationRate).toBeNull();
    expect(result.repeat30).toBeNull();
    expect(result.repeat60).toBeNull();
    expect(result.repeat90).toBeNull();
  });

  it('fixed_costsが未設定(null)の場合はbreakeven_point/month_profit_estがnull', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20',
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 40000 })],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    expect(result.breakevenPoint).toBeNull();
    expect(result.monthProfitEst).toBeNull();
  });

  it('fixed_costs(jsonb内訳・null混在)を数値リーフのみ合算しbreakeven_point/month_profit_estを算出する', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20', // elapsed=20, totalDays=30
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 40000 })], // forecast=60000
      variableCostRate: 0.2,
      fixedCosts: { rent: 100000, social_insurance_actual: null },
    });

    // fixedCostsTotal = 100000(nullは無視)
    expect(result.breakevenPoint).toBe(Math.round(100000 / 0.8)); // 125000
    // month_profit_est = forecastSales×(1-rate) − fixedCostsTotal = 60000×0.8−100000
    expect(result.monthProfitEst).toBe(Math.round(60000 * 0.8 - 100000)); // -52000
  });

  it('来店人数(visit_count)は来店件数でなくユニーク顧客数', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20',
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-06-01' }),
        visit({ customerId: 'c1', visitDate: '2026-06-10' }), // 同一顧客2回目来店(件数+1だが人数は+0)
        visit({ customerId: 'c2', visitDate: '2026-06-05' }),
      ],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    expect(result.visitCount).toBe(2);
  });

  it('nomination_rateは当月来店のうちisNomination=trueの割合', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20',
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-06-01', isNomination: true }),
        visit({ customerId: 'c2', visitDate: '2026-06-05', isNomination: true }),
        visit({ customerId: 'c3', visitDate: '2026-06-10', isNomination: false }),
        visit({ customerId: 'c4', visitDate: '2026-06-12', isNomination: false }),
      ],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    expect(result.nominationRate).toBe(0.5);
  });

  it('repeat_30/60/90は直前来店からの間隔(日数)が閾値以内だった割合(初回来店は分母から除外)', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-20',
      visits: [
        // A: 前回2026-05-01→今回2026-06-01 = 31日(30日超・60/90日以内)
        visit({ customerId: 'a', visitDate: '2026-05-01' }),
        visit({ customerId: 'a', visitDate: '2026-06-01' }),
        // D: 前回2026-05-25→今回2026-06-05 = 11日(30/60/90日いずれも以内)
        visit({ customerId: 'd', visitDate: '2026-05-25' }),
        visit({ customerId: 'd', visitDate: '2026-06-05' }),
        // F: 前回2026-04-01→今回2026-06-05 = 65日(60日超・90日以内)
        visit({ customerId: 'f', visitDate: '2026-04-01' }),
        visit({ customerId: 'f', visitDate: '2026-06-05' }),
        // E: 当月が初回来店(直前来店なし)→分母から除外
        visit({ customerId: 'e', visitDate: '2026-06-10' }),
      ],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    // 分母=3(a,d,f。eは初回のため除外)
    expect(result.repeat30).toBeCloseTo(1 / 3); // d のみ
    expect(result.repeat60).toBeCloseTo(2 / 3); // a, d
    expect(result.repeat90).toBeCloseTo(3 / 3); // a, d, f
  });

  it('前月以前の来店も含めた全履歴から直前来店を探す(月初直後の来店が前月の来店を正しく参照する)', () => {
    const result = computeDashboardAggregate({
      storeId: 'store-1',
      snapshotDate: '2026-06-05',
      visits: [
        visit({ customerId: 'a', visitDate: '2026-05-20' }),
        visit({ customerId: 'a', visitDate: '2026-06-01' }), // 前月来店から12日後
      ],
      variableCostRate: 0.2,
      fixedCosts: null,
    });

    expect(result.repeat30).toBe(1);
  });
});

describe('runDashboardAggregator', () => {
  function createFakeRepos(
    visits: Visit[],
    settings: BusinessSettings | null,
    opts: { customers?: Customer[]; staff?: Staff[]; subscriptions?: Subscription[]; recentSnapshots?: DashboardSnapshot[] } = {}
  ): DashboardAggregatorRepos & { upsertDaily: ReturnType<typeof vi.fn> } {
    const upsertDaily = vi.fn().mockResolvedValue(undefined);
    return {
      visitRepo: { listByStore: vi.fn().mockResolvedValue(visits) } as unknown as DashboardAggregatorRepos['visitRepo'],
      businessSettingsRepo: { findByStoreAndMonth: vi.fn().mockResolvedValue(settings) } as unknown as DashboardAggregatorRepos['businessSettingsRepo'],
      dashboardRepo: {
        upsertDaily,
        listSinceDate: vi.fn().mockResolvedValue(opts.recentSnapshots ?? []),
      } as unknown as DashboardAggregatorRepos['dashboardRepo'],
      customerRepo: { listByStore: vi.fn().mockResolvedValue(opts.customers ?? []) } as unknown as DashboardAggregatorRepos['customerRepo'],
      staffRepo: { listByStore: vi.fn().mockResolvedValue(opts.staff ?? []) } as unknown as DashboardAggregatorRepos['staffRepo'],
      subscriptionRepo: { listByStore: vi.fn().mockResolvedValue(opts.subscriptions ?? []) } as unknown as DashboardAggregatorRepos['subscriptionRepo'],
      upsertDaily,
    };
  }

  it('visitRepo.listByStore+businessSettingsRepo.findByStoreAndMonthを取得し、結果をdashboardRepo.upsertDailyへ渡す', async () => {
    const settings: BusinessSettings = {
      storeId: 'store-1', month: '2026-06-01', salesTarget: 2500000,
      fixedCosts: { rent: 100000 }, variableCostRate: 0.2, seatCapacity: null, variableRates: null,
    };
    const repos = createFakeRepos(
      [visit({ customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 40000 })],
      settings
    );

    const result = await runDashboardAggregator({ storeId: 'store-1', snapshotDate: '2026-06-20' }, repos);

    expect(repos.visitRepo.listByStore).toHaveBeenCalledWith('store-1');
    expect(repos.businessSettingsRepo.findByStoreAndMonth).toHaveBeenCalledWith('store-1', '2026-06-01');
    expect(repos.upsertDaily).toHaveBeenCalledWith(result);
    expect(result.monthlySales).toBe(40000);
    expect(result.breakevenPoint).toBe(Math.round(100000 / 0.8));
  });

  it('business_settingsが存在しない場合はvariableCostRate=0・fixedCosts=nullとして計算する(breakeven/profitはnull)', async () => {
    const repos = createFakeRepos(
      [visit({ customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 40000 })],
      null
    );

    const result = await runDashboardAggregator({ storeId: 'store-1', snapshotDate: '2026-06-20' }, repos);

    expect(result.breakevenPoint).toBeNull();
    expect(result.monthProfitEst).toBeNull();
    expect(result.monthlySales).toBe(40000);
  });

  it('customerRepo/staffRepo/subscriptionRepo/dashboardRepo.listSinceDateを取得し、AIWarningEngineの結果をaiInsightsとして合成する(既存の計算式は変更しない)', async () => {
    const customers: Customer[] = [{
      id: 'c1', storeId: 'store-1', name: '田中花子', ageGroup: null, customerType: null, typeConfidence: 0,
      goalNote: null, weddingDate: null, acquisitionChannel: null, firstVisitDate: null,
      assignedStaffId: 'staff-1', isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
      consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
    }];
    const staff: Staff[] = [{ id: 'staff-1', storeId: 'store-1', name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] }];
    const visits = [
      visit({ customerId: 'c1', visitDate: '2026-01-01', treatmentAmount: 10000 }),
      visit({ customerId: 'c1', visitDate: '2026-02-01', treatmentAmount: 10000 }),
    ];
    const repos = createFakeRepos(visits, null, { customers, staff });

    const result = await runDashboardAggregator({ storeId: 'store-1', snapshotDate: '2026-06-20' }, repos);

    expect(repos.customerRepo.listByStore).toHaveBeenCalledWith('store-1');
    expect(repos.staffRepo.listByStore).toHaveBeenCalledWith('store-1');
    expect(repos.subscriptionRepo.listByStore).toHaveBeenCalledWith('store-1');
    expect(repos.dashboardRepo.listSinceDate).toHaveBeenCalledWith('store-1', '2026-05-01');
    // 既存の計算式(MTD売上等)は変更されていない
    expect(result.monthlySales).toBe(0); // 6月の来店が無いため0(1-2月の来店は対象外・既存仕様)
    // AI Warning(失客予兆: c1は来店周期を大きく超過)が合成されている
    expect(result.aiInsights?.some((i) => i.title === '失客予兆')).toBe(true);
    expect(repos.upsertDaily).toHaveBeenCalledWith(result);
  });

  it('前月の最終スナップショットをリピート率低下判定の基準として使う', async () => {
    const recentSnapshots: DashboardSnapshot[] = [
      {
        storeId: 'store-1', snapshotDate: '2026-05-30', monthlySales: 0, forecastSales: 0, breakevenPoint: null,
        repeatRate90d: null, rebookingRate: null, homecareRate: null, segmentMatrix: {}, funnel: {}, staffMatrix: {},
        aiInsights: [], dmToBookingRate: null, repeat30: 0.6, repeat60: null, repeat90: null, newRatio: null,
        nominationRate: null, monthProfitEst: null, vipCustomerIds: [], relationTriggers: {}, occupancy: {}, visitCount: null,
      },
    ];
    // c1の直前来店(2026-04-01)から06-10来店まで70日(30日超)のため、今月のrepeat30(直前来店からの
    // 30日以内再来率)は0(=計算式は既存のrepeatRateWithin・無変更)。前月0.6から大幅低下=ルール発火。
    const visits = [
      visit({ customerId: 'c1', visitDate: '2026-04-01', treatmentAmount: 10000 }),
      visit({ customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 10000 }),
    ];
    const repos = createFakeRepos(visits, null, { recentSnapshots });

    const result = await runDashboardAggregator({ storeId: 'store-1', snapshotDate: '2026-06-20' }, repos);

    expect(result.repeat30).toBe(0); // 既存計算式そのまま(無変更であることの確認)
    expect(result.aiInsights?.some((i) => i.title === 'リピート率低下')).toBe(true);
  });
});

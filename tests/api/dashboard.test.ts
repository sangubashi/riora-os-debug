import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/dashboard/route';
import { getRepos } from '../../app/lib/repos';
import type { DashboardSnapshot } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const DASHBOARD: DashboardSnapshot = {
  storeId: 'store-1',
  snapshotDate: '2026-06-12',
  monthlySales: 1200000,
  forecastSales: 1500000,
  breakevenPoint: 900000,
  repeatRate90d: 0.42,
  rebookingRate: 0.55,
  homecareRate: 0.3,
  segmentMatrix: {},
  funnel: {},
  staffMatrix: {},
  aiInsights: [],
  dmToBookingRate: 0.23,
  repeat30: 0.5,
  repeat60: 0.45,
  repeat90: 0.4,
  newRatio: 0.3,
  nominationRate: 0.6,
  monthProfitEst: -38000,
  visitCount: 18,
  vipCustomerIds: [],
  relationTriggers: {},
  occupancy: {},
};

const mockRepos = {
  customerRepo: { findById: vi.fn(), listByStore: vi.fn() },
  visitRepo: { recentByCustomer: vi.fn(), create: vi.fn(), countByCustomer: vi.fn() },
  lineQueueRepo: { enqueue: vi.fn(), listPendingByStore: vi.fn(), updateStatus: vi.fn() },
  dashboardRepo: { latestByStore: vi.fn() },
  briefingRepo: { latestByCustomer: vi.fn() },
  revisionRepo: { approve: vi.fn() },
};

describe('GET /api/dashboard (GetDashboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.dashboardRepo.latestByStore.mockResolvedValue(DASHBOARD);
  });

  it('正常系: dashboardを返す', async () => {
    const res = await GET(new NextRequest('http://localhost/api/dashboard?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, dashboard: DASHBOARD });
  });

  it('storeIdを引数として渡す', async () => {
    await GET(new NextRequest('http://localhost/api/dashboard?storeId=store-1'));

    expect(mockRepos.dashboardRepo.latestByStore).toHaveBeenCalledWith('store-1');
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(new NextRequest('http://localhost/api/dashboard'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('dashboardが存在しない場合は404を返す', async () => {
    mockRepos.dashboardRepo.latestByStore.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/dashboard?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'dashboard_not_found' });
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await GET(new NextRequest('http://localhost/api/dashboard?storeId=store-1'));

    expect(res.status).toBe(500);
  });

  it('dashboardRepo.latestByStore()が例外をthrowした場合は500を返す', async () => {
    mockRepos.dashboardRepo.latestByStore.mockRejectedValue(new Error('DashboardRepo.latestByStore failed: db down'));

    const res = await GET(new NextRequest('http://localhost/api/dashboard?storeId=store-1'));

    expect(res.status).toBe(500);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/customer-assets/route';
import { getRepos } from '../../app/lib/repos';
import type { Customer, Visit, Subscription } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

function customer(id: string, name: string): Customer {
  return {
    id, storeId: 'store-1', name, ageGroup: null, customerType: null,
    typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
    firstVisitDate: null, assignedStaffId: null, isSubscriber: false,
    subscribedAt: null, churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
    prefecture: null, city: null, externalKeyHash: null,
  };
}

function visit(id: string, customerId: string, visitDate: string): Visit {
  return {
    id, storeId: 'store-1', customerId, staffId: 'staff-1', menuId: 'menu-1',
    visitDate, visitCountAt: 1, isNomination: true, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

const mockRepos = {
  customerRepo: { listByStore: vi.fn() },
  visitRepo: { listByStore: vi.fn() },
  subscriptionRepo: { listByStore: vi.fn() },
};

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/customer-assets${qs}`);
}

describe('GET /api/admin/customer-assets (画面③顧客管理)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.customerRepo.listByStore.mockResolvedValue([customer('c1', '田中花子')]);
    mockRepos.visitRepo.listByStore.mockResolvedValue([visit('v1', 'c1', '2026-06-01')]);
    mockRepos.subscriptionRepo.listByStore.mockResolvedValue([] as Subscription[]);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('顧客一覧(来店回数/最終来店日/LTV/累計売上/指名状況/来店間隔)を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customerAssets).toEqual([
      {
        customerId: 'c1',
        customerName: '田中花子',
        visitCount: 1,
        lastVisitDate: '2026-06-01',
        totalSales: 10000,
        ltv: 10000,
        nominationRate: 1,
        avgIntervalDays: null,
      },
    ]);
  });

  it('顧客が0件の場合は空配列を返す', async () => {
    mockRepos.customerRepo.listByStore.mockResolvedValue([]);
    mockRepos.visitRepo.listByStore.mockResolvedValue([]);

    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customerAssets).toEqual([]);
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.visitRepo.listByStore.mockRejectedValue(new Error('db down'));

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});

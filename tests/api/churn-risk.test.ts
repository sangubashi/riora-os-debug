import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/churn-risk/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { Customer, Visit, Staff } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

function customer(opts: { id: string; name: string; assignedStaffId?: string | null }): Customer {
  return {
    id: opts.id, storeId: 'store-1', name: opts.name, ageGroup: null, customerType: null,
    typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
    firstVisitDate: null, assignedStaffId: opts.assignedStaffId ?? null, isSubscriber: false,
    subscribedAt: null, churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
    prefecture: null, city: null, externalKeyHash: null,
  };
}

function visit(id: string, customerId: string, visitDate: string): Visit {
  return {
    id, storeId: 'store-1', customerId, staffId: 'staff-1', menuId: 'menu-1',
    visitDate, visitCountAt: 1, isNomination: false, treatmentAmount: 5000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

function staffRow(id: string, name: string): Staff {
  return { id, storeId: 'store-1', name, style: 'evidence', isActive: true, nameAliases: [] };
}

const mockRepos = {
  customerRepo: { listByStore: vi.fn() },
  visitRepo: { listByStore: vi.fn() },
  staffRepo: { listByStore: vi.fn() },
};

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/churn-risk${qs}`);
}

describe('GET /api/admin/churn-risk (画面②離脱予兆センター)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    mockRepos.customerRepo.listByStore.mockResolvedValue([
      customer({ id: 'c1', name: '危険客', assignedStaffId: 'staff-1' }),
    ]);
    mockRepos.visitRepo.listByStore.mockResolvedValue([
      visit('v1', 'c1', '2026-05-02'),
      visit('v2', 'c1', '2026-06-01'),
    ]);
    mockRepos.staffRepo.listByStore.mockResolvedValue([staffRow('staff-1', '鈴木')]);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('危険顧客一覧(最終来店日/来店間隔/失客リスクスコア/担当スタッフ)を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-07-21'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dangerCustomers).toEqual([
      {
        customerId: 'c1',
        customerName: '危険客',
        lastVisitDate: '2026-06-01',
        daysSinceLastVisit: 50,
        avgIntervalDays: 30,
        churnRiskScore: (50 / 30 - 1) / 2,
        assignedStaffId: 'staff-1',
        assignedStaffName: '鈴木',
      },
    ]);
  });

  it('危険客が0件の場合は空配列を返す(エラーにしない)', async () => {
    mockRepos.visitRepo.listByStore.mockResolvedValue([visit('v1', 'c1', '2026-06-20')]);

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dangerCustomers).toEqual([]);
  });

  it('date未指定の場合はサーバー現在日時を基準日に使う(リクエストはエラーにならない)', async () => {
    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(200);
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

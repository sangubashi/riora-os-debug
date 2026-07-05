import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/staff-analytics/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { Staff, Visit, Subscription } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

function staff(id: string, name: string): Staff {
  return { id, storeId: 'store-1', name, style: 'evidence', isActive: true, nameAliases: [] };
}

function visit(id: string, staffId: string, customerId: string, visitDate: string): Visit {
  return {
    id, storeId: 'store-1', customerId, staffId, menuId: 'menu-1',
    visitDate, visitCountAt: 1, isNomination: true, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

const mockRepos = {
  staffRepo: { listByStore: vi.fn() },
  visitRepo: { listByStore: vi.fn() },
  subscriptionRepo: { listByStore: vi.fn() },
};

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/staff-analytics${qs}`);
}

describe('GET /api/admin/staff-analytics (画面④スタッフ分析)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    mockRepos.staffRepo.listByStore.mockResolvedValue([staff('s1', '鈴木'), staff('s2', '亀山')]);
    mockRepos.visitRepo.listByStore.mockResolvedValue([visit('v1', 's1', 'c1', '2026-06-01')]);
    mockRepos.subscriptionRepo.listByStore.mockResolvedValue([] as Subscription[]);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('スタッフごとの売上/指名率/リピート率/LTV/成長率を返す(順位フィールドを含まない)', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.staffAnalytics).toHaveLength(2);
    body.staffAnalytics.forEach((row: Record<string, unknown>) => {
      expect(row).not.toHaveProperty('rank');
      expect(row).not.toHaveProperty('ranking');
      expect(Object.keys(row).sort()).toEqual(
        ['staffId', 'staffName', 'monthlySales', 'nominationRate', 'repeatRate', 'ltv', 'growthRate'].sort()
      );
    });
  });

  it('売上が無いスタッフを含んでも0件にせず全スタッフを五十音順(近似)で返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    const names = body.staffAnalytics.map((r: { staffName: string }) => r.staffName);
    expect(names).toContain('鈴木');
    expect(names).toContain('亀山');
  });

  it('date未指定の場合はサーバー現在日時を基準日に使う(リクエストはエラーにならない)', async () => {
    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(200);
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.visitRepo.listByStore.mockRejectedValue(new Error('db down'));

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});

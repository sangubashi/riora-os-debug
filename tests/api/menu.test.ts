import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/menu/route';
import { getRepos } from '../../app/lib/repos';
import type { Menu, Visit } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

function menu(id: string, name: string, price: number): Menu {
  return { id, storeId: 'store-1', name, price, role: 'entry', targetTypes: [] };
}

function visit(menuId: string, visitDate: string): Visit {
  return {
    id: `v-${menuId}-${visitDate}`, storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', menuId,
    visitDate, visitCountAt: 1, isNomination: false, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

const mockRepos = {
  menuRepo: { listByStore: vi.fn() },
  visitRepo: { listByStore: vi.fn() },
};

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/menu${qs}`);
}

describe('GET /api/admin/menu (メニュー画面)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.menuRepo.listByStore.mockResolvedValue([menu('m1', 'プレミアムケア', 18000)]);
    mockRepos.visitRepo.listByStore.mockResolvedValue([visit('m1', '2026-06-01')]);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('メニュー一覧とサマリーを返す(実データソースが無い指標はnull)', async () => {
    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.menus).toHaveLength(1);
    expect(body.menus[0]).toMatchObject({
      id: 'm1', name: 'プレミアムケア', price: 18000,
      repeatRate: null, profitMargin: null, aiRecommendRate: null,
      upsellSuccessRate: null, vipConversionRate: null,
    });
    expect(body.summary.totalMenuCount).toBe(1);
  });

  it('メニューが0件の場合は空配列を返す', async () => {
    mockRepos.menuRepo.listByStore.mockResolvedValue([]);
    mockRepos.visitRepo.listByStore.mockResolvedValue([]);

    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.menus).toEqual([]);
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

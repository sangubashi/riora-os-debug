import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/occupancy/route';
import { getRepos } from '../../app/lib/repos';
import type { BusinessSettings } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const SETTINGS_NO_CAPACITY: BusinessSettings = {
  storeId: 'store-1', month: '2026-06-01', salesTarget: 2500000,
  fixedCosts: null, variableCostRate: 0.25, seatCapacity: null, variableRates: null,
};

const mockRepos = {
  occupancyRepo: { staffOccupancy: vi.fn(), visitsByDayOfWeek: vi.fn() },
  businessSettingsRepo: { findByStoreAndMonth: vi.fn() },
};

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/occupancy${qs}`);
}

describe('GET /api/admin/occupancy (画面⑤稼働率分析)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.occupancyRepo.staffOccupancy.mockResolvedValue([
      { staffId: 's1', staffName: '鈴木', visitCount: 10, sales: 100000, nominationRate: 0.5 },
    ]);
    mockRepos.occupancyRepo.visitsByDayOfWeek.mockResolvedValue([
      { dayOfWeek: 'mon', visitCount: 3 }, { dayOfWeek: 'tue', visitCount: 0 },
      { dayOfWeek: 'wed', visitCount: 1 }, { dayOfWeek: 'thu', visitCount: 0 },
      { dayOfWeek: 'fri', visitCount: 2 }, { dayOfWeek: 'sat', visitCount: 0 },
      { dayOfWeek: 'sun', visitCount: 0 },
    ]);
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(SETTINGS_NO_CAPACITY);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildUrl(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('①スタッフ別稼働状況・②曜日別来店数を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.staffOccupancy).toEqual([
      { staffId: 's1', staffName: '鈴木', visitCount: 10, sales: 100000, nominationRate: 0.5 },
    ]);
    expect(body.dayOfWeekVisits).toHaveLength(7);
    expect(body.dayOfWeekVisits[0]).toEqual({ dayOfWeek: 'mon', visitCount: 3 });
  });

  it('③時間帯別来店数は常にavailable:falseと理由を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    expect(body.hourlyVisits.available).toBe(false);
    expect(body.hourlyVisits.reason).toContain('来店時刻');
  });

  it('④稼働率推移はseat_capacity未設定の場合available:falseでその旨の理由を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    expect(body.occupancyTrend.available).toBe(false);
    expect(body.occupancyTrend.reason).toContain('seat_capacity');
  });

  it('seat_capacityが設定済みでも時間帯データが無いためoccupancyTrendはavailable:falseのまま', async () => {
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue({
      ...SETTINGS_NO_CAPACITY, seatCapacity: { mon: { '10': 2 } },
    });

    const res = await GET(buildUrl('?storeId=store-1&date=2026-06-23'));
    const body = await res.json();

    expect(body.occupancyTrend.available).toBe(false);
    expect(body.occupancyTrend.reason).not.toContain('seat_capacity');
    expect(body.occupancyTrend.reason).toContain('来店時刻');
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.occupancyRepo.staffOccupancy.mockRejectedValue(new Error('db down'));

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/admin/business-settings/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { BusinessSettings } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

// requireAdmin() 経由でadmin@salon-riora.jpとして認証済みの状態を既定でモックする。
// 本テストファイルの目的はルート自体のビジネスロジック検証であり、認証は前提条件のため
// 各テストで個別にモックし直す必要はない。
const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const SETTINGS: BusinessSettings = {
  storeId: 'store-1', month: '2026-06-01', salesTarget: 2500000,
  fixedCosts: { rent: 437646 }, variableCostRate: 0.075, seatCapacity: null, variableRates: null,
};

const mockRepos = {
  businessSettingsRepo: {
    findByStoreAndMonth: vi.fn(),
    findLatestBeforeOrAt: vi.fn(),
    upsert: vi.fn(),
  },
  opsLogRepo: { insert: vi.fn() },
};

function buildGetReq(qs: string) {
  return new NextRequest(`http://localhost/api/admin/business-settings${qs}`);
}

function buildPostReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/business-settings', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

describe('GET /api/admin/business-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    // 当月行が有効なfixedCostsを持つ場合はフォールバックへ進まないため、既定はnullでよい。
    mockRepos.businessSettingsRepo.findLatestBeforeOrAt.mockResolvedValue(null);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildGetReq(''));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('設定済みの場合はBusinessSettingsを返す', async () => {
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(SETTINGS);
    const res = await GET(buildGetReq('?storeId=store-1&month=2026-06-01'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings).toEqual(SETTINGS);
    expect(mockRepos.businessSettingsRepo.findByStoreAndMonth).toHaveBeenCalledWith('store-1', '2026-06-01');
  });

  it('未設定の場合はsettings:nullを返す(エラーにしない)', async () => {
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(null);
    const res = await GET(buildGetReq('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings).toBeNull();
  });

  it('monthを省略した場合は当月の1日を既定値にする', async () => {
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(null);
    await GET(buildGetReq('?storeId=store-1'));
    const [, calledMonth] = mockRepos.businessSettingsRepo.findByStoreAndMonth.mock.calls[0];
    expect(calledMonth).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('POST /api/admin/business-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    // POSTは変更前後をbrain_ops_logsへ監査記録する(本テストの検証対象外のため既定値を設定するのみ)。
    mockRepos.opsLogRepo.insert.mockResolvedValue({ id: 'log-tmp', createdAt: '2026-06-23T00:00:00.000Z' });
  });

  it('不正なJSONの場合は400(invalid_json)を返す', async () => {
    const req = new NextRequest('http://localhost/api/admin/business-settings', { method: 'POST', body: '{bad' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('monthの形式が不正な場合は400(validation_error)を返す', async () => {
    const res = await POST(buildPostReq({ storeId: 'store-1', month: '2026-06' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_error');
  });

  it('variableCostRateが1以上の場合は400(validation_error)を返す(CHECK制約に合わせる)', async () => {
    const res = await POST(buildPostReq({ storeId: 'store-1', month: '2026-06-01', variableCostRate: 1.5 }));
    expect(res.status).toBe(400);
  });

  it('固定費・変動費率をUPSERTし、更新後の設定を返す(計算は行わない)', async () => {
    mockRepos.businessSettingsRepo.upsert.mockResolvedValue(SETTINGS);
    const payload = {
      storeId: 'store-1', month: '2026-06-01',
      fixedCosts: { rent: 437646, officer_suzuki: 450000, social_insurance_actual: null },
      variableCostRate: 0.075,
      variableRates: { incentive_rate: 0.05, square_rate: 0.025 },
    };
    const res = await POST(buildPostReq(payload));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.settings).toEqual(SETTINGS);
    expect(mockRepos.businessSettingsRepo.upsert).toHaveBeenCalledWith(payload);
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const res = await POST(buildPostReq({ storeId: 'store-1', month: '2026-06-01' }));
    expect(res.status).toBe(500);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.businessSettingsRepo.upsert.mockRejectedValue(new Error('db down'));
    const res = await POST(buildPostReq({ storeId: 'store-1', month: '2026-06-01' }));
    expect(res.status).toBe(500);
  });
});

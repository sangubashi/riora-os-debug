import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/cron/dashboard-aggregator/route';
import { getRepos } from '../../app/lib/repos';
import * as aggregatorModule from '../../src/lib/dashboard/DashboardAggregator';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const mockRepos = {
  visitRepo: { listByStore: vi.fn() },
  businessSettingsRepo: { findByStoreAndMonth: vi.fn() },
  dashboardRepo: { upsertDaily: vi.fn(), listSinceDate: vi.fn() },
  customerRepo: { listByStore: vi.fn() },
  staffRepo: { listByStore: vi.fn() },
  subscriptionRepo: { listByStore: vi.fn() },
};

function buildReq(authHeader?: string) {
  const headers = authHeader ? { authorization: authHeader } : undefined;
  return new NextRequest('http://localhost/api/cron/dashboard-aggregator', { headers });
}

describe('GET /api/cron/dashboard-aggregator', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.visitRepo.listByStore.mockResolvedValue([]);
    mockRepos.businessSettingsRepo.findByStoreAndMonth.mockResolvedValue(null);
    mockRepos.dashboardRepo.upsertDaily.mockResolvedValue(undefined);
    mockRepos.dashboardRepo.listSinceDate.mockResolvedValue([]);
    mockRepos.customerRepo.listByStore.mockResolvedValue([]);
    mockRepos.staffRepo.listByStore.mockResolvedValue([]);
    mockRepos.subscriptionRepo.listByStore.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it('CRON_SECRET未設定の環境では認証を求めずに実行する', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(buildReq());
    expect(res.status).toBe(200);
  });

  it('CRON_SECRET設定済みでAuthorizationヘッダが無い場合は401を返す', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
  });

  it('CRON_SECRET設定済みでAuthorizationヘッダが一致しない場合は401を返す', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const res = await GET(buildReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRETが一致する場合はrunDashboardAggregatorを実行する', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const spy = vi.spyOn(aggregatorModule, 'runDashboardAggregator');

    const res = await GET(buildReq('Bearer test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockRepos.dashboardRepo.upsertDaily).toHaveBeenCalledTimes(1);
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    delete process.env.CRON_SECRET;
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
  });

  it('集計処理が例外をthrowした場合は500を返す', async () => {
    delete process.env.CRON_SECRET;
    mockRepos.visitRepo.listByStore.mockRejectedValue(new Error('db down'));
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
  });
});

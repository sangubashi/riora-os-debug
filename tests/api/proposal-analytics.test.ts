import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/proposal-analytics/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { BriefingEntry, OutcomeLite, PatternStepStatSummary } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};
const STAFF = {
  authUserId: 'staff-auth-uid', staffBrainId: 'staff-1',
  email: 'staff@example.com', isAdmin: false,
};

function fireLog(id: string, createdAt: string): BriefingEntry {
  return { id, customerId: 'c1', customerName: '', visitId: null, decisionRecord: {} as never, explanation: 'x', createdAt };
}

function outcome(overrides: Partial<OutcomeLite> = {}): OutcomeLite {
  return {
    patternId: 'B1', stepNo: 1, proposalKind: 'homecare', visitCountAt: 2,
    wasExecuted: false, wasAccepted: false, occurredAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const STEP_STATS: PatternStepStatSummary[] = [
  { candidateCode: 'B1-step1', patternId: 'B1', stepNo: 1, customerType: 'B_pore', staffStyle: 'theory', executedN: 10, acceptedN: 4, laplaceRate: 0.4, avgFireScore: null },
];

const mockRepos = {
  briefingRepo: { listSinceByStore: vi.fn() },
  outcomeRepo: { listSinceByStore: vi.fn() },
  statsRepo: { listAllStepStats: vi.fn() },
};

function buildReq(qs: string) {
  return new NextRequest(`http://localhost/api/admin/proposal-analytics${qs}`);
}

describe('GET /api/admin/proposal-analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    mockRepos.briefingRepo.listSinceByStore.mockResolvedValue([fireLog('f1', '2026-07-01T00:00:00Z')]);
    mockRepos.outcomeRepo.listSinceByStore.mockResolvedValue([outcome({ wasExecuted: true })]);
    mockRepos.statsRepo.listAllStepStats.mockResolvedValue(STEP_STATS);
  });

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);
    const res = await GET(buildReq('?storeId=store-1'));
    expect(res.status).toBe(401);
  });

  it('管理者以外は403を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    const res = await GET(buildReq('?storeId=store-1'));
    expect(res.status).toBe(403);
  });

  it('storeId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildReq(''));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_error');
  });

  it('正常系: summary/monthlyTrend/patternSuccessRateを返す', async () => {
    const res = await GET(buildReq('?storeId=store-1&range=30d'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.range).toBe('30d');
    expect(body.summary.displayCount).toBe(1);
    expect(body.summary.outcomeCount).toBe(1);
    expect(body.summary.executedCount).toBe(1);
    expect(body.summary.executionRatePct).toBe(100);
    expect(body.summary.treatmentMatchRatePct).toBe(100);
    expect(body.monthlyTrend).toEqual([{ month: '2026-07', displayCount: 1, executedCount: 1 }]);
    expect(body.patternSuccessRate).toEqual([
      expect.objectContaining({ candidateCode: 'B1-step1', executedN: 10, successRatePct: 40 }),
    ]);
    expect(body.truncated).toBe(false);
  });

  it('range省略時は30dをデフォルトにし、sinceIsoを渡してlistSinceByStoreを呼ぶ', async () => {
    await GET(buildReq('?storeId=store-1'));

    expect(mockRepos.briefingRepo.listSinceByStore).toHaveBeenCalledWith('store-1', expect.any(String), expect.any(Number));
    expect(mockRepos.outcomeRepo.listSinceByStore).toHaveBeenCalledWith('store-1', expect.any(String), expect.any(Number));
  });

  it("range=allの場合はsinceIso(第2引数)にnullを渡す", async () => {
    await GET(buildReq('?storeId=store-1&range=all'));

    expect(mockRepos.briefingRepo.listSinceByStore).toHaveBeenCalledWith('store-1', null, expect.any(Number));
    expect(mockRepos.outcomeRepo.listSinceByStore).toHaveBeenCalledWith('store-1', null, expect.any(Number));
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const res = await GET(buildReq('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});

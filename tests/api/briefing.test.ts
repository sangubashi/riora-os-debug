import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/briefing/route';
import { getRepos } from '../../app/lib/repos';
import type { BriefingEntry, DecisionRecord } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const BRIEFING: BriefingEntry = {
  id: 'fire-1',
  customerId: 'cust-1',
  customerName: '山田花子',
  visitId: 'visit-1',
  decisionRecord: {} as DecisionRecord,
  explanation: 'ホームケア提案を優先しました',
  createdAt: '2026-06-12T00:00:00Z',
};

const mockRepos = {
  customerRepo: { findById: vi.fn(), listByStore: vi.fn() },
  visitRepo: { recentByCustomer: vi.fn(), create: vi.fn(), countByCustomer: vi.fn() },
  lineQueueRepo: { enqueue: vi.fn(), listPendingByStore: vi.fn(), updateStatus: vi.fn() },
  dashboardRepo: { latestByStore: vi.fn() },
  briefingRepo: { latestByCustomer: vi.fn() },
  revisionRepo: { approve: vi.fn() },
};

describe('GET /api/briefing (GetBriefing, P0簡易版)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.briefingRepo.latestByCustomer.mockResolvedValue(BRIEFING);
  });

  it('正常系: briefingを返す', async () => {
    const res = await GET(new NextRequest('http://localhost/api/briefing?customerId=cust-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, briefing: BRIEFING });
  });

  it('customerIdを引数として渡す', async () => {
    await GET(new NextRequest('http://localhost/api/briefing?customerId=cust-1'));

    expect(mockRepos.briefingRepo.latestByCustomer).toHaveBeenCalledWith('cust-1');
  });

  it('customerId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(new NextRequest('http://localhost/api/briefing'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('briefingが存在しない場合は404を返す', async () => {
    mockRepos.briefingRepo.latestByCustomer.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/briefing?customerId=cust-1'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'briefing_not_found' });
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await GET(new NextRequest('http://localhost/api/briefing?customerId=cust-1'));

    expect(res.status).toBe(500);
  });

  it('briefingRepo.latestByCustomer()が例外をthrowした場合は500を返す', async () => {
    mockRepos.briefingRepo.latestByCustomer.mockRejectedValue(
      new Error('BriefingRepo.latestByCustomer failed: db down')
    );

    const res = await GET(new NextRequest('http://localhost/api/briefing?customerId=cust-1'));

    expect(res.status).toBe(500);
  });
});

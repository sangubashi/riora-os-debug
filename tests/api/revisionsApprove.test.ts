import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/revisions/[id]/approve/route';
import { getRepos } from '../../app/lib/repos';
import type { RevisionRecord } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const STORE_REVISION: RevisionRecord = {
  id: 'rev-1',
  scope: 'store',
  storeId: 'store-1',
  patternId: 'B1',
  changeType: 'timing',
  before: { cooldown_visits: 2 },
  after: { cooldown_visits: 3 },
  evidence: { sample_size: 50 },
  status: 'approved',
  decidedBy: 'admin-1',
  decidedAt: '2026-06-13T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
};

const BRAND_REVISION: RevisionRecord = {
  ...STORE_REVISION,
  id: 'rev-2',
  scope: 'brand',
  storeId: null,
  patternId: 'B2',
};

const mockRepos = {
  customerRepo: { findById: vi.fn(), listByStore: vi.fn() },
  visitRepo: { recentByCustomer: vi.fn(), create: vi.fn(), countByCustomer: vi.fn() },
  lineQueueRepo: { enqueue: vi.fn(), listPendingByStore: vi.fn(), updateStatus: vi.fn() },
  dashboardRepo: { latestByStore: vi.fn() },
  briefingRepo: { latestByCustomer: vi.fn() },
  revisionRepo: { approve: vi.fn() },
};

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/revisions/rev-1/approve', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function callPost(body: unknown, id = 'rev-1') {
  return POST(buildRequest(body), { params: Promise.resolve({ id }) });
}

describe('POST /api/revisions/:id/approve (ApproveRevision)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.revisionRepo.approve.mockResolvedValue(STORE_REVISION);
  });

  it('scope=storeの正常系: 更新後のrevisionを返す', async () => {
    const res = await callPost({ scope: 'store', decidedBy: 'admin-1' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, revision: STORE_REVISION });
  });

  it('scope=brandの正常系: 更新後のrevisionを返す', async () => {
    mockRepos.revisionRepo.approve.mockResolvedValue(BRAND_REVISION);

    const res = await callPost({ scope: 'brand', decidedBy: 'admin-2' }, 'rev-2');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, revision: BRAND_REVISION });
  });

  it('scope・id・decidedByをapprove()へ渡す', async () => {
    await callPost({ scope: 'store', decidedBy: 'admin-1' }, 'rev-1');

    expect(mockRepos.revisionRepo.approve).toHaveBeenCalledWith('store', 'rev-1', 'admin-1');
  });

  it('不正なscopeの場合は400(validation_error)を返す', async () => {
    const res = await callPost({ scope: 'invalid', decidedBy: 'admin-1' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('decidedByが欠落している場合は400(validation_error)を返す', async () => {
    const res = await callPost({ scope: 'store' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('不正なJSONの場合は400を返す', async () => {
    const res = await callPost('not-json');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'invalid_json' });
  });

  it('対象が存在しないかstatus!=proposedの場合は404を返す', async () => {
    mockRepos.revisionRepo.approve.mockResolvedValue(null);

    const res = await callPost({ scope: 'store', decidedBy: 'admin-1' }, 'rev-999');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'revision_not_found' });
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await callPost({ scope: 'store', decidedBy: 'admin-1' });

    expect(res.status).toBe(500);
  });

  it('revisionRepo.approve()が例外をthrowした場合は500を返す', async () => {
    mockRepos.revisionRepo.approve.mockRejectedValue(new Error('RevisionRepo.approve failed: db down'));

    const res = await callPost({ scope: 'store', decidedBy: 'admin-1' });

    expect(res.status).toBe(500);
  });
});

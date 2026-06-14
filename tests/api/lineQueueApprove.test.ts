import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/line-queue/[id]/approve/route';
import { getRepos } from '../../app/lib/repos';
import type { LineQueueItem } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const QUEUE_ITEM: LineQueueItem = {
  id: 'queue-1',
  storeId: 'store-1',
  customerId: 'cust-1',
  scenarioCode: 'scenario-A',
  templateId: 'template-1',
  scheduledAt: '2026-06-15T10:00:00Z',
  approvalStatus: 'approved',
  createdAt: '2026-06-13T00:00:00Z',
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
  return new NextRequest('http://localhost/api/line-queue/queue-1/approve', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function callPost(body: unknown, id = 'queue-1') {
  return POST(buildRequest(body), { params: Promise.resolve({ id }) });
}

describe('POST /api/line-queue/:id/approve (ApproveLineSend)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.lineQueueRepo.updateStatus.mockResolvedValue(QUEUE_ITEM);
  });

  it('正常系: 更新後のitemを返す', async () => {
    const res = await callPost({ status: 'approved' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, item: QUEUE_ITEM });
  });

  it('id・statusをupdateStatusへ渡す', async () => {
    await callPost({ status: 'rejected' }, 'queue-1');

    expect(mockRepos.lineQueueRepo.updateStatus).toHaveBeenCalledWith('queue-1', 'rejected');
  });

  it('不正なstatusの場合は400(validation_error)を返す', async () => {
    const res = await callPost({ status: 'unknown' });
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

  it('対象が存在しない場合は404を返す', async () => {
    mockRepos.lineQueueRepo.updateStatus.mockResolvedValue(null);

    const res = await callPost({ status: 'approved' }, 'queue-999');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'queue_item_not_found' });
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await callPost({ status: 'approved' });

    expect(res.status).toBe(500);
  });

  it('lineQueueRepo.updateStatus()が例外をthrowした場合は500を返す', async () => {
    mockRepos.lineQueueRepo.updateStatus.mockRejectedValue(
      new Error('LineQueueRepo.updateStatus failed: db down')
    );

    const res = await callPost({ status: 'approved' });

    expect(res.status).toBe(500);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/csv/history/route';
import { getRepos } from '../../app/lib/repos';
import type { OpsLog } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const mockRepos = { opsLogRepo: { recentByStoreAndKind: vi.fn() } };

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/csv/history${qs}`);
}

describe('GET /api/admin/csv/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
  });

  it('brain_ops_logs(kind=csv_import)から件数のみの履歴を返す(PIIを含まない)', async () => {
    const log: OpsLog = {
      id: 'log-1', storeId: 'store-1', kind: 'csv_import', actorId: null,
      detail: { newCustomers: 3, updatedCustomers: 5, visitsImported: 8, unresolvedStaffCount: 1, piiFoundTotal: 0, durationMs: 100 },
      createdAt: '2026-06-23T00:00:00.000Z',
    };
    mockRepos.opsLogRepo.recentByStoreAndKind.mockResolvedValue([log]);

    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.history).toEqual([{
      id: 'log-1', importedAt: '2026-06-23T00:00:00.000Z', actorName: 'owner',
      newCustomers: 3, updatedCustomers: 5, visits: 8, unresolvedStaffCount: 1,
    }]);
    expect(mockRepos.opsLogRepo.recentByStoreAndKind).toHaveBeenCalledWith('store-1', 'csv_import', 20);
  });

  it('履歴が無い場合は空配列を返す', async () => {
    mockRepos.opsLogRepo.recentByStoreAndKind.mockResolvedValue([]);

    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(body.history).toEqual([]);
  });

  it('storeId省略時はDEMO_STORE_IDを使う', async () => {
    mockRepos.opsLogRepo.recentByStoreAndKind.mockResolvedValue([]);

    await GET(buildUrl(''));

    expect(mockRepos.opsLogRepo.recentByStoreAndKind).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001', 'csv_import', 20
    );
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.opsLogRepo.recentByStoreAndKind.mockRejectedValue(new Error('db down'));

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});

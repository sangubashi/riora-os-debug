// ================================================================
// POST /api/admin/visits/reclassify-menus 検証(PHASE CSV-RECOVERY-2)
//
// runMenuReclassification()自体のロジックはtests/lib/import/runMenuReclassification.test.ts
// で検証済みのため、このテストはルート層のパラメータ解釈(recoverFallbackNames/dryRunの
// form fieldをどう解釈してrunMenuReclassification()へ渡すか)のみを検証する。
// ================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/admin/visits/reclassify-menus/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { runMenuReclassification } from '@/lib/import/runMenuReclassification';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));
vi.mock('@/lib/import/runMenuReclassification', () => ({ runMenuReclassification: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const FAKE_REPORT = { updated: 0, noChange: 0, skipped: 0, errors: 0, details: [], dryRun: false };

function buildRequest(fields: Record<string, string | Blob>): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest('http://localhost/api/admin/visits/reclassify-menus', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/admin/visits/reclassify-menus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue({} as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    vi.mocked(runMenuReclassification).mockResolvedValue(FAKE_REPORT as never);
  });

  it('recoverFallbackNames/dryRun未指定の場合、両方undefinedでrunMenuReclassification()を呼ぶ(既存動作のまま)', async () => {
    const file = new File(['dummy'], 'test.csv', { type: 'text/csv' });
    const res = await POST(buildRequest({ file, storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(runMenuReclassification).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        recoverFallbackNames: undefined,
        dryRun: undefined,
      }),
      expect.anything(),
    );
  });

  it('recoverFallbackNames="true"のみ指定した場合、dryRunはundefinedのまま渡す(呼び出し先のデフォルトtrueに委ねる)', async () => {
    const file = new File(['dummy'], 'test.csv', { type: 'text/csv' });
    const res = await POST(buildRequest({ file, storeId: 'store-1', recoverFallbackNames: 'true' }));
    expect(res.status).toBe(200);

    expect(runMenuReclassification).toHaveBeenCalledWith(
      expect.objectContaining({ recoverFallbackNames: true, dryRun: undefined }),
      expect.anything(),
    );
  });

  it('recoverFallbackNames="true"かつdryRun="false"を明示すると、両方そのまま渡す', async () => {
    const file = new File(['dummy'], 'test.csv', { type: 'text/csv' });
    const res = await POST(buildRequest({
      file, storeId: 'store-1', recoverFallbackNames: 'true', dryRun: 'false',
    }));
    expect(res.status).toBe(200);

    expect(runMenuReclassification).toHaveBeenCalledWith(
      expect.objectContaining({ recoverFallbackNames: true, dryRun: false }),
      expect.anything(),
    );
  });

  it('report(変更予定一覧を含む)をそのままレスポンスで返す', async () => {
    const detailedReport = {
      updated: 1, noChange: 0, skipped: 0, errors: 0,
      details: [{ visitDate: '2026-06-01', customerName: '田中花子', rawMenuName: '毛穴洗浄コース', beforeMenuId: 'menu-fallback', afterMenuId: '(新規作成予定)', method: 'fallback_other_recovered', applied: false }],
      dryRun: true,
    };
    vi.mocked(runMenuReclassification).mockResolvedValue(detailedReport as never);

    const file = new File(['dummy'], 'test.csv', { type: 'text/csv' });
    const res = await POST(buildRequest({ file, storeId: 'store-1', recoverFallbackNames: 'true' }));
    const body = await res.json();

    expect(body.report).toEqual(detailedReport);
  });

  it('file未指定の場合は400(file_required)を返す(既存仕様のまま)', async () => {
    const res = await POST(buildRequest({ storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('file_required');
    expect(runMenuReclassification).not.toHaveBeenCalled();
  });

  it('未認証の場合は401を返す(既存仕様のまま)', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null as never);
    const file = new File(['dummy'], 'test.csv', { type: 'text/csv' });
    const res = await POST(buildRequest({ file, storeId: 'store-1' }));

    expect(res.status).toBe(401);
    expect(runMenuReclassification).not.toHaveBeenCalled();
  });
});

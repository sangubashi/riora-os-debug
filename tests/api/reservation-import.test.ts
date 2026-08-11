// ================================================================
// POST /api/admin/csv/reservation-import 検証(最小)
//
// 集計ロジック本体(runReservationImportPipeline)はtests/lib/import/
// reservationImportPipeline.test.tsで検証済みのため、本テストはPHASE
// actor_id是正の確認に絞る: requireAdmin()で解決したauthUserIdが
// actorIdとしてrunReservationImportPipelineへ渡ることのみを検証する。
// ================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/admin/csv/reservation-import/route';
import { getRepos, getServiceClient } from '../../app/lib/repos';
import { runReservationImportPipeline } from '../../src/lib/import/reservationImportPipeline';
import { refreshDashboardAfterImport } from '@/lib/dashboard/DashboardAggregator';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn(), getServiceClient: vi.fn() }));
vi.mock('../../src/lib/import/reservationImportPipeline', () => ({ runReservationImportPipeline: vi.fn() }));
vi.mock('@/lib/dashboard/DashboardAggregator', () => ({ refreshDashboardAfterImport: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

function buildFileReq(opts: { file?: File; storeId?: string; reviewDecisions?: string }) {
  const form = new FormData();
  if (opts.file) form.append('file', opts.file);
  if (opts.storeId) form.append('storeId', opts.storeId);
  if (opts.reviewDecisions !== undefined) form.append('reviewDecisions', opts.reviewDecisions);
  return new NextRequest('http://localhost/api/admin/csv/reservation-import', { method: 'POST', body: form });
}

describe('POST /api/admin/csv/reservation-import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue({} as never);
    vi.mocked(getServiceClient).mockReturnValue({} as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
  });

  it('認証済みadminのauthUserIdをactorIdとしてrunReservationImportPipelineへ渡す', async () => {
    vi.mocked(runReservationImportPipeline).mockResolvedValue({
      ok: true,
      report: { created: 1, updated: 0, skipped: 0, needsReviewCount: 0, durationMs: 5 },
    });
    const file = new File(['x'], 'a.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));

    expect(res.status).toBe(200);
    expect(vi.mocked(runReservationImportPipeline).mock.calls[0][0].actorId).toBe('admin-auth-uid');
    // dashboard_rebuildログ用にも同じauthUserIdが第3引数として渡ること(PHASE actor_id是正)
    expect(vi.mocked(refreshDashboardAfterImport).mock.calls[0][2]).toBe('admin-auth-uid');
  });

  it('未認証の場合は401でrunReservationImportPipelineは呼ばれない', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);
    const file = new File(['x'], 'a.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));

    expect(res.status).toBe(401);
    expect(runReservationImportPipeline).not.toHaveBeenCalled();
  });
});

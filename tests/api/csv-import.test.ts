// ================================================================
// POST /api/admin/csv/import 検証
//
// 集計ロジック本体(runImportPipeline)はtests/lib/import/csvImportPipeline.test.ts
// で検証済みのため、本テストはルート自身の責務(multipart解析・reviewDecisions
// JSONパース・ファイル検証・エラー整形)のみをrunImportPipelineのモックで検証する。
// ================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/admin/csv/import/route';
import { getRepos } from '../../app/lib/repos';
import { runImportPipeline } from '../../src/lib/import/csvImportPipeline';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('../../src/lib/import/csvImportPipeline', () => ({ runImportPipeline: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const EMPTY_QUALITY_REPORT = {
  score: 100, level: 'excellent' as const, totalCheckouts: 0, warnings: [],
  menuResolution: { exactMatch: 0, normalizedMatch: 0, partialMatch: 0, fallbackOther: 0, unresolved: 0, entries: [] },
  duplicateCustomerNames: [],
  rates: { customerResolutionRate: 0, staffResolutionRate: 1, menuResolutionRate: 1, importedOtherRate: 0, errorCount: 0, skippedCount: 0 },
};

function buildFileReq(opts: { file?: File; storeId?: string; reviewDecisions?: string }) {
  const form = new FormData();
  if (opts.file) form.append('file', opts.file);
  if (opts.storeId) form.append('storeId', opts.storeId);
  if (opts.reviewDecisions !== undefined) form.append('reviewDecisions', opts.reviewDecisions);
  return new NextRequest('http://localhost/api/admin/csv/import', { method: 'POST', body: form });
}

describe('POST /api/admin/csv/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue({} as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
  });

  it('fileが無い場合は400(file_required)を返す', async () => {
    const res = await POST(buildFileReq({ storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('file_required');
    expect(runImportPipeline).not.toHaveBeenCalled();
  });

  it('reviewDecisionsを正しくパースしてrunImportPipelineへ渡す', async () => {
    vi.mocked(runImportPipeline).mockResolvedValue({
      ok: true,
      report: {
        newCustomers: 1, updatedCustomers: 0, visitsImported: 1, piiFoundTotal: 0, failedChunks: 0, durationMs: 10,
        menuResolution: { exactMatch: 1, normalizedMatch: 0, partialMatch: 0, fallbackOther: 0, unresolved: 0, entries: [] },
        unresolvedStaffCount: 0, qualityReport: EMPTY_QUALITY_REPORT,
      },
    });
    const file = new File(['x'], 'a.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1', reviewDecisions: JSON.stringify({ 3: 'merge' }) }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.newCustomers).toBe(1);
    expect(vi.mocked(runImportPipeline).mock.calls[0][0].reviewDecisions).toEqual({ 3: 'merge' });
  });

  it('reviewDecisionsが不正なJSONの場合は空オブジェクトとして扱う(リクエスト自体は失敗しない)', async () => {
    vi.mocked(runImportPipeline).mockResolvedValue({
      ok: true,
      report: {
        newCustomers: 0, updatedCustomers: 0, visitsImported: 0, piiFoundTotal: 0, failedChunks: 0, durationMs: 5,
        menuResolution: { exactMatch: 0, normalizedMatch: 0, partialMatch: 0, fallbackOther: 0, unresolved: 0, entries: [] },
        unresolvedStaffCount: 0, qualityReport: EMPTY_QUALITY_REPORT,
      },
    });
    const file = new File(['x'], 'a.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1', reviewDecisions: '{not-json' }));

    expect(res.status).toBe(200);
    expect(vi.mocked(runImportPipeline).mock.calls[0][0].reviewDecisions).toEqual({});
  });

  it('runImportPipelineがok:falseの場合は400で{code,message}を返す', async () => {
    vi.mocked(runImportPipeline).mockResolvedValue({ ok: false, code: 'empty_csv', message: 'CSVが空です' });
    const file = new File([''], 'empty.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('empty_csv');
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const file = new File(['x'], 'a.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    expect(res.status).toBe(500);
  });
});

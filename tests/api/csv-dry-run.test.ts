// ================================================================
// POST /api/admin/csv/dry-run 検証
//
// 集計ロジック本体(buildDryRunResult)はtests/lib/import/csvImportPipeline.test.ts
// で検証済みのため、本テストはルート自身の責務(multipart解析・ファイル検証・
// storeId既定値・エラー整形)のみをbuildDryRunResultのモックで検証する。
// ================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/admin/csv/dry-run/route';
import { getRepos } from '../../app/lib/repos';
import { buildDryRunResult } from '../../src/lib/import/csvImportPipeline';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('../../src/lib/import/csvImportPipeline', () => ({ buildDryRunResult: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const EMPTY_QUALITY_REPORT = {
  score: 100, level: 'excellent' as const, totalCheckouts: 0, warnings: [],
  menuResolution: { exactMatch: 0, normalizedMatch: 0, partialMatch: 0, fallbackOther: 0, unresolved: 0, entries: [] },
  duplicateCustomerNames: [],
  proximityMatchCount: 0, proximityReviewCount: 0, visitProximityClosestCount: 0,
  rates: { customerResolutionRate: 0, nameProximityResolutionRate: 0, combinedCustomerResolutionRate: 0, staffResolutionRate: 1, menuResolutionRate: 1, importedOtherRate: 0, errorCount: 0, skippedCount: 0 },
};

function buildFileReq(opts: { file?: File; storeId?: string }) {
  const form = new FormData();
  if (opts.file) form.append('file', opts.file);
  if (opts.storeId) form.append('storeId', opts.storeId);
  return new NextRequest('http://localhost/api/admin/csv/dry-run', { method: 'POST', body: form });
}

describe('POST /api/admin/csv/dry-run', () => {
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
    expect(buildDryRunResult).not.toHaveBeenCalled();
  });

  it('ファイルサイズが10MBを超える場合は400(file_too_large)を返す', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csv');
    const res = await POST(buildFileReq({ file: big, storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('file_too_large');
  });

  it('storeId省略時はDEMO_STORE_IDを使ってbuildDryRunResultを呼ぶ', async () => {
    vi.mocked(buildDryRunResult).mockResolvedValue({
      ok: true,
      result: { fileName: 'a.csv', totalRows: 1, importable: 1, needsReview: [], skipped: [], unknownColumns: [], droppedColumns: [], piiFoundTotal: 0, unresolvedStaff: [], preview: [], qualityReport: EMPTY_QUALITY_REPORT, csvType: 'detail' as const, csvInfoMessage: null },
    });
    const file = new File(['会計日,区分\n2026/06/01,施術'], 'a.csv');

    const res = await POST(buildFileReq({ file }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.totalRows).toBe(1);
    expect(vi.mocked(buildDryRunResult).mock.calls[0][0].storeId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('buildDryRunResultがok:falseの場合は400で{code,message}を返す', async () => {
    vi.mocked(buildDryRunResult).mockResolvedValue({ ok: false, code: 'empty_csv', message: 'CSVが空です' });
    const file = new File([''], 'empty.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('empty_csv');
    expect(body.message).toBe('CSVが空です');
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const file = new File(['x'], 'a.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    expect(res.status).toBe(500);
  });

  // ── 予約CSV分岐(Phase 1-F) ──────────────────────────────────────────────
  // 予約CSVは売上明細CSV専用のbuildDryRunResult()には回さず、形式判定結果のみを
  // 返す。かつてはここでcsvInfoMessageに「次フェーズで対応予定」という、実際には
  // 既に実装済みの機能を「未対応」と誤案内する文言が入っていたが、Phase 1-Fで
  // 削除した(csvTypeDetector.ts側の修正)。この分岐自体もPhase 1-Fまでテストが
  // 存在しなかった。
  const RESERVATION_CSV_HEADER =
    'ステータス,スタッフ名,来店日,開始時間,終了時間,所要時間,お名前,予約時合計金額';

  it('予約CSVの場合はbuildDryRunResult()を呼ばずcsvType:reservationを返す', async () => {
    const file = new File([`${RESERVATION_CSV_HEADER}\n受付待ち,鈴木,20260801,1000,1100,60,山田花子,8000\n`], 'r.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.csvType).toBe('reservation');
    expect(buildDryRunResult).not.toHaveBeenCalled();
  });

  it('予約CSVの場合はcsvInfoMessageがnullである(「次フェーズで対応予定」等の誤案内を出さない)', async () => {
    const file = new File([`${RESERVATION_CSV_HEADER}\n受付待ち,鈴木,20260801,1000,1100,60,山田花子,8000\n`], 'r.csv');

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    const body = await res.json();

    expect(body.csvInfoMessage).toBeNull();
  });

  it('予約CSVの場合はtotalRowsをCSVの実行数(ヘッダーを除く)から算出する', async () => {
    const file = new File(
      [`${RESERVATION_CSV_HEADER}\n受付待ち,鈴木,20260801,1000,1100,60,山田花子,8000\n受付待ち,亀山,20260802,1200,1300,60,佐藤太郎,9000\n`],
      'r.csv'
    );

    const res = await POST(buildFileReq({ file, storeId: 'store-1' }));
    const body = await res.json();

    expect(body.totalRows).toBe(2);
  });
});

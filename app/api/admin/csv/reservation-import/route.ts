/**
 * POST /api/admin/csv/reservation-import(予約CSV専用Import・RES-5)
 *
 * Dry Run結果(needsReview)の名寄せ決定を踏まえてreservationsへUPSERTする。
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md(RES-2)・
 *   docs/design/RESERVATION_IMPORT_IMPLEMENTATION_PLAN_V1.md §6/§7
 *
 * 既存の /api/admin/csv/import(売上明細CSV専用)とは完全に分離した新規エンドポイント。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { decodeCsvBuffer } from '@/lib/import/csvEncoding';
import { runReservationImportPipeline } from '@/lib/import/reservationImportPipeline';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { refreshDashboardAfterImport } from '@/lib/dashboard/DashboardAggregator';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function parseReviewDecisions(raw: string | null): Record<number, 'merge' | 'new'> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<number, 'merge' | 'new'>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_form_data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'file_required' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'file_too_large' }, { status: 400 });
  }

  const storeId = (form.get('storeId') as string | null) || DEMO_STORE_ID;
  const reviewDecisions = parseReviewDecisions(form.get('reviewDecisions') as string | null);

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const csvText = decodeCsvBuffer(buf);

    const result = await runReservationImportPipeline(
      { storeId, fileName: file.name, csvText, reviewDecisions },
      repos,
      getServiceClient()
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.code, message: result.message }, { status: 400 });
    }

    // PHASE MD-4: 取込成功後にbrain_dashboard_dailyを自動再生成する。
    // 失敗してもCSV取込自体は成功のまま扱う(要件③・Warningログのみ)。
    try {
      await refreshDashboardAfterImport(repos, storeId);
    } catch (e) {
      console.warn('[reservation-import] dashboard rebuild failed (non-fatal):', e);
    }

    return NextResponse.json({ success: true, ...result.report });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

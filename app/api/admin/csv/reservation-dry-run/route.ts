/**
 * POST /api/admin/csv/reservation-dry-run(予約CSV専用Dry Run・RES-5)
 *
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md(RES-2)・
 *   docs/design/RESERVATION_IMPORT_IMPLEMENTATION_PLAN_V1.md §5
 *
 * 既存の /api/admin/csv/dry-run(売上明細CSV専用)とは完全に分離した新規エンドポイント。
 * 既存エンドポイントには一切手を加えない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { decodeCsvBuffer } from '@/lib/import/csvEncoding';
import { buildReservationDryRunResult } from '@/lib/import/reservationImportPipeline';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const csvText = decodeCsvBuffer(buf);

    const dryRun = await buildReservationDryRunResult(
      { storeId, fileName: file.name, csvText },
      repos,
      getServiceClient()
    );
    if (!dryRun.ok) {
      return NextResponse.json({ success: false, error: dryRun.code, message: dryRun.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...dryRun.result });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

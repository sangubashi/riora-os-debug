/**
 * POST /api/admin/csv/dry-run (画面⑥①②)
 *
 * SalonBoard売上明細CSVをアップロードし、保存せず検証する。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { decodeCsvBuffer } from '@/lib/import/csvEncoding';
import { buildDryRunResult } from '@/lib/import/csvImportPipeline';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
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

    const dryRun = await buildDryRunResult({ storeId, fileName: file.name, csvText }, repos);
    if (!dryRun.ok) {
      return NextResponse.json({ success: false, error: dryRun.code, message: dryRun.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...dryRun.result });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

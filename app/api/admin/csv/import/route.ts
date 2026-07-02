/**
 * POST /api/admin/csv/import (画面⑥⑤)
 *
 * Dry Run結果(画面⑥②③④)の名寄せ・スタッフ紐付け決定を踏まえてCSVを取り込む。
 * スタッフ紐付け(③)はbindStaff時点でPOST /api/admin/staff-alasesにより
 * brain_staff.name_aliasesへ即時反映済みのため、ここではreviewDecisions(④)のみ受け取る。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4,6
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { decodeCsvBuffer } from '@/lib/import/csvEncoding';
import { runImportPipeline } from '@/lib/import/csvImportPipeline';
import { parseHeadersFromCsv, detectCsvType } from '@/lib/import/csvTypeDetector';
import type { ReviewDecisionValue } from '@/components/admin/csv-import/types';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function parseReviewDecisions(raw: string | null): Record<number, ReviewDecisionValue> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<number, ReviewDecisionValue>;
  } catch {
    return {};
  }
}

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

    const headers = parseHeadersFromCsv(csvText);
    const { type: csvType } = detectCsvType(headers);

    const result = await runImportPipeline({ storeId, fileName: file.name, csvType, csvText, reviewDecisions }, repos);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.code, message: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...result.report });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

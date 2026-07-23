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
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { refreshDashboardAfterImport } from '@/lib/dashboard/DashboardAggregator';
import { runCustomerTypeClassification } from '@/lib/customerType/runCustomerTypeClassification';

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

    const headers = parseHeadersFromCsv(csvText);
    const { type: csvType } = detectCsvType(headers);

    const result = await runImportPipeline({ storeId, fileName: file.name, csvType, csvText, reviewDecisions }, repos);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.code, message: result.message }, { status: 400 });
    }

    // PHASE MD-4: 取込成功後にbrain_dashboard_dailyを自動再生成する。
    // 失敗してもCSV取込自体は成功のまま扱う(要件③・Warningログのみ)。
    try {
      await refreshDashboardAfterImport(repos, storeId);
    } catch (e) {
      console.warn('[csv-import] dashboard rebuild failed (non-fatal):', e);
    }

    // PHASE 1-A: 取込成功後にcustomer_type未設定顧客の再分類を試みる(MD-4と同じnon-fatalパターン)。
    // 既存customer_type保護はrunCustomerTypeClassification内部で担保済み(既存値は上書きしない)。
    try {
      await runCustomerTypeClassification(storeId, repos);
    } catch (e) {
      console.warn('[csv-import] customer type classification failed (non-fatal):', e);
    }

    return NextResponse.json({ success: true, ...result.report });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

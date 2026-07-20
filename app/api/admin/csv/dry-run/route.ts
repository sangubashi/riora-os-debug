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
import { parseHeadersFromCsv, detectCsvType } from '@/lib/import/csvTypeDetector';
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

    const headers = parseHeadersFromCsv(csvText);
    const { type: csvType, infoMessage: csvInfoMessage } = detectCsvType(headers);

    // 予約CSVはエラーにせず情報メッセージのみ返す(次フェーズで対応予定)。
    if (csvType === 'reservation') {
      const totalRows = Math.max(0, csvText.split(/\r?\n/).filter(l => l.trim() !== '').length - 1);
      return NextResponse.json({
        success: true,
        fileName: file.name,
        totalRows,
        importable: 0,
        needsReview: [],
        skipped: [],
        unknownColumns: [],
        droppedColumns: [],
        piiFoundTotal: 0,
        unresolvedStaff: [],
        preview: [],
        qualityReport: {
          score: 0, level: 'poor', totalCheckouts: 0, warnings: [],
          menuResolution: { exactMatch: 0, normalizedMatch: 0, partialMatch: 0, fallbackOther: 0, unresolved: 0, entries: [] },
          duplicateCustomerNames: [],
          proximityMatchCount: 0, proximityReviewCount: 0, visitProximityClosestCount: 0,
          rates: { customerResolutionRate: 0, nameProximityResolutionRate: 0, combinedCustomerResolutionRate: 0, staffResolutionRate: 0, menuResolutionRate: 0, importedOtherRate: 0, errorCount: 0, skippedCount: 0 },
        },
        csvType,
        csvInfoMessage,
      });
    }

    const dryRun = await buildDryRunResult({ storeId, fileName: file.name, csvText, csvType }, repos);
    if (!dryRun.ok) {
      return NextResponse.json({ success: false, error: dryRun.code, message: dryRun.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...dryRun.result });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

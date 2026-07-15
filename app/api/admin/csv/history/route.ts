/**
 * GET /api/admin/csv/history?storeId=... (画面⑥取込履歴)
 *
 * brain_ops_logs(kind='csv_import')から件数・日時のみ返す(内容/PIIは記録されていない)。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4
 *
 * kind='reservation_csv_import'側は追加でdetail.skippedDetail(行番号・顧客名・理由コード)も
 * 返す(CSV_IMPORT_HISTORY_UI_1: スキップ理由確認UI)。customerNameはCSV由来の氏名で、
 * PII方針上ops_logsへの記録自体は既存実装(reservationImportPipeline.ts)で決定済みのため、
 * ここでは素通しするのみ。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import type {
  ImportHistoryItem,
  ReservationImportHistoryItem,
  ReservationSkipReasonCode,
  SkippedDetailEntry,
} from '@/components/admin/csv-import/types';
import { requireAdmin } from '@/lib/auth/requireAdmin';

function readNumber(detail: Record<string, unknown>, key: string): number {
  const v = detail[key];
  return typeof v === 'number' ? v : 0;
}

const RESERVATION_SKIP_REASON_CODES: ReservationSkipReasonCode[] = [
  'missing_field', 'unresolved_staff', 'unresolved_status', 'invalid_datetime',
];

function readSkippedDetail(detail: Record<string, unknown>): SkippedDetailEntry[] {
  const raw = detail['skippedDetail'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is SkippedDetailEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e['rowNumber'] === 'number' &&
      typeof e['customerName'] === 'string' &&
      typeof e['reasonCode'] === 'string' &&
      RESERVATION_SKIP_REASON_CODES.includes(e['reasonCode'] as ReservationSkipReasonCode)
    );
  });
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const storeId = req.nextUrl.searchParams.get('storeId') || DEMO_STORE_ID;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [logs, reservationLogs] = await Promise.all([
      repos.opsLogRepo.recentByStoreAndKind(storeId, 'csv_import', 20),
      repos.opsLogRepo.recentByStoreAndKind(storeId, 'reservation_csv_import', 20),
    ]);

    const history: ImportHistoryItem[] = logs.map((log) => ({
      id: log.id,
      importedAt: log.createdAt,
      actorName: 'owner',
      newCustomers: readNumber(log.detail, 'newCustomers'),
      updatedCustomers: readNumber(log.detail, 'updatedCustomers'),
      visits: readNumber(log.detail, 'visitsImported'),
      unresolvedStaffCount: readNumber(log.detail, 'unresolvedStaffCount'),
    }));

    const reservationHistory: ReservationImportHistoryItem[] = reservationLogs.map((log) => ({
      id: log.id,
      importedAt: log.createdAt,
      actorName: 'owner',
      created: readNumber(log.detail, 'created'),
      updated: readNumber(log.detail, 'updated'),
      skipped: readNumber(log.detail, 'skipped'),
      needsReviewCount: readNumber(log.detail, 'needsReviewCount'),
      skippedDetail: readSkippedDetail(log.detail),
    }));

    return NextResponse.json({ success: true, history, reservationHistory });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

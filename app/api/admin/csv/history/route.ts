/**
 * GET /api/admin/csv/history?storeId=... (画面⑥取込履歴)
 *
 * brain_ops_logs(kind='csv_import')から件数・日時のみ返す(内容/PIIは記録されていない)。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import type { ImportHistoryItem } from '@/components/admin/csv-import/types';

function readNumber(detail: Record<string, unknown>, key: string): number {
  const v = detail[key];
  return typeof v === 'number' ? v : 0;
}

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId') || DEMO_STORE_ID;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const logs = await repos.opsLogRepo.recentByStoreAndKind(storeId, 'csv_import', 20);
    const history: ImportHistoryItem[] = logs.map((log) => ({
      id: log.id,
      importedAt: log.createdAt,
      actorName: 'owner',
      newCustomers: readNumber(log.detail, 'newCustomers'),
      updatedCustomers: readNumber(log.detail, 'updatedCustomers'),
      visits: readNumber(log.detail, 'visitsImported'),
      unresolvedStaffCount: readNumber(log.detail, 'unresolvedStaffCount'),
    }));

    return NextResponse.json({ success: true, history });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

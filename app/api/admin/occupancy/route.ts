/**
 * GET /api/admin/occupancy?storeId=...&date=... (画面⑤稼働率分析・MD-5)
 *
 * 集計ロジック(スタッフ別稼働状況・曜日別来店数)はOccupancyRepo(Repository層)が担う
 * (ユーザー指示・2026-06-23・本タスク限定の方針)。本ルートはGETのみで編集機能を持たない。
 *
 * 時間帯別来店数(③)・稼働率推移(④)は既存テーブル(brain_visits/brain_business_settings/
 * brain_dashboard_daily)だけでは算出不可能なことをDB確認で確認済み:
 *   - brain_visits.visit_dateはdate型で時刻を保持しない(来店時刻データが存在しない)
 *   - brain_business_settings.seat_capacity(曜日×時間帯別の席数)が未設定(null)
 * ダミーデータでの代替は禁止のため、available:falseと理由のみを返す
 * (新規テーブル・migrationなしの制約下での誠実な現状報告)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { occupancyQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const HOURLY_UNAVAILABLE_REASON =
  'brain_visitsに来店時刻を保持する列が存在しないため算出できません(visit_dateはdate型で時刻情報を持たず、created_atはCSV取込/入力時のDB書込時刻であり実際の来店時刻ではありません)。';

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = occupancyQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    date: req.nextUrl.searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const { storeId } = parsed.data;
  const date = parsed.data.date ?? todayIso();

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [staffOccupancy, dayOfWeekVisits, settings] = await Promise.all([
      repos.occupancyRepo.staffOccupancy(storeId),
      repos.occupancyRepo.visitsByDayOfWeek(storeId),
      repos.businessSettingsRepo.findByStoreAndMonth(storeId, firstOfMonth(date)),
    ]);

    const seatCapacityConfigured = settings?.seatCapacity != null;

    return NextResponse.json({
      success: true,
      storeId,
      date,
      staffOccupancy,
      dayOfWeekVisits,
      hourlyVisits: { available: false, reason: HOURLY_UNAVAILABLE_REASON },
      occupancyTrend: {
        available: false,
        reason: seatCapacityConfigured
          ? HOURLY_UNAVAILABLE_REASON
          : `seat_capacity(曜日×時間帯別の席数)が未設定のため算出できません。加えて${HOURLY_UNAVAILABLE_REASON}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

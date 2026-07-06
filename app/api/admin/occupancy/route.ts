/**
 * GET /api/admin/occupancy?storeId=...&date=... (画面⑤稼働率分析・MD-5)
 *
 * 集計ロジック(スタッフ別稼働状況・曜日別来店数)はOccupancyRepo(Repository層)が担う
 * (ユーザー指示・2026-06-23・本タスク限定の方針)。本ルートはGETのみで編集機能を持たない。
 *
 * 時間帯別来店数(③)・稼働分数推移(④)は、RES-5(予約CSV Import)によりreservationsへ
 * scheduled_at(timestamptz)+duration_minutesが投入されるようになったため算出可能(Tier1)。
 * reservationsが空(予約CSV未取込)の場合はavailable:falseのまま理由を返す。
 *
 * 稼働率(%)(Tier2・brain_business_settings.seat_capacity使用)は本フェーズの対象外。
 * seat_capacity未設定の間は「稼働分数」までの表示にとどめる(RES-4/RES-5確定方針)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { occupancyQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const HOURLY_UNAVAILABLE_REASON =
  '予約CSV(reservations)が未取込のため算出できません(予約一覧CSVを取り込むと時間帯別来店数が表示されます)。';
const TREND_UNAVAILABLE_REASON =
  '予約CSV(reservations)が未取込のため算出できません(稼働率%にはbrain_business_settings.seat_capacityの設定も別途必要です)。';

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 指定日から遡ってN日前のJST日付(YYYY-MM-DD)を返す(稼働分数推移の集計窓)。 */
function daysBefore(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00+09:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const TREND_WINDOW_DAYS = 30;

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
    const [staffOccupancy, dayOfWeekVisits, settings, hourlyVisitsData, occupancyTrendData] = await Promise.all([
      repos.occupancyRepo.staffOccupancy(storeId),
      repos.occupancyRepo.visitsByDayOfWeek(storeId),
      repos.businessSettingsRepo.findByStoreAndMonth(storeId, firstOfMonth(date)),
      repos.occupancyRepo.hourlyVisits(),
      repos.occupancyRepo.occupancyTrend(daysBefore(date, TREND_WINDOW_DAYS), date),
    ]);

    const seatCapacityConfigured = settings?.seatCapacity != null;

    const hourlyVisitsTotal = hourlyVisitsData.reduce((sum, h) => sum + h.visitCount, 0);
    const occupancyTrendTotal = occupancyTrendData.reduce((sum, p) => sum + p.occupiedMinutes, 0);

    return NextResponse.json({
      success: true,
      storeId,
      date,
      staffOccupancy,
      dayOfWeekVisits,
      hourlyVisits: hourlyVisitsTotal > 0
        ? { available: true, data: hourlyVisitsData }
        : { available: false, reason: HOURLY_UNAVAILABLE_REASON },
      occupancyTrend: occupancyTrendTotal > 0
        ? {
            available: true,
            data: occupancyTrendData,
            seatCapacityConfigured,
            note: seatCapacityConfigured
              ? null
              : '稼働率%はseat_capacity未設定のため算出していません(稼働分数のみ表示)。',
          }
        : { available: false, reason: TREND_UNAVAILABLE_REASON },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

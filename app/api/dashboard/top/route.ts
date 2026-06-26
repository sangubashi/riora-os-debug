/**
 * GET /api/dashboard/top?storeId=...&date=...(GetDashboardTop・画面①経営TOP/MD-1)
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面①
 *   (v2.1はCSV取込状況カードのみ追加・新規API化はしない方針のため本routeへ統合)
 *
 * 集計はnightly-dashboard(brain_dashboard_daily)が生成した値を読むだけ。
 * 本日売上のみ当日visitsから軽量集計する(v2.0「本日売上=当日visits軽量COUNT」)。
 * スタッフランキングはv2.0画面④(MD-4・売上単体表示禁止)の別契約のため本APIには含めない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { dashboardTopQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const parsed = dashboardTopQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    date: req.nextUrl.searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const { storeId } = parsed.data;
  const date = parsed.data.date ?? todayIso();
  const month = firstOfMonth(date);

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [snapshot, trend, settings, todaySales, csvImportLogs] = await Promise.all([
      repos.dashboardRepo.latestByStore(storeId),
      repos.dashboardRepo.listSinceDate(storeId, month),
      repos.businessSettingsRepo.findByStoreAndMonth(storeId, month),
      repos.visitRepo.sumSalesByStoreAndDate(storeId, date),
      repos.opsLogRepo.recentByStoreAndKind(storeId, 'csv_import', 1),
    ]);

    const monthlySales = snapshot?.monthlySales ?? 0;
    const breakevenPoint = snapshot?.breakevenPoint ?? null;
    const salesTarget = settings?.salesTarget ?? null;
    const fixedCostsConfigured = settings?.fixedCosts != null;

    const csvLog = csvImportLogs[0] ?? null;
    const csvImportStatus = csvLog
      ? {
          lastImportedAt: csvLog.createdAt,
          newCustomers: Number(csvLog.detail.newCustomers ?? 0),
          updatedCustomers: Number(csvLog.detail.updatedCustomers ?? 0),
          visitsImported: Number(csvLog.detail.visitsImported ?? 0),
          unresolvedStaffCount: Number(csvLog.detail.unresolvedStaffCount ?? 0),
        }
      : null;

    return NextResponse.json({
      success: true,
      storeId,
      date,
      month,
      required4: {
        monthlySales,
        profit: fixedCostsConfigured ? snapshot?.monthProfitEst ?? null : null,
        breakevenPoint,
        breakevenRemaining: breakevenPoint === null ? null : Math.max(breakevenPoint - monthlySales, 0),
        forecastSales: snapshot?.forecastSales ?? 0,
        fixedCostsConfigured,
      },
      kpi4: {
        todaySales,
        targetProgress: salesTarget !== null && salesTarget > 0 ? monthlySales / salesTarget : null,
        salesTarget,
        rebookingRate: snapshot?.rebookingRate ?? null,
        dmToBookingRate: snapshot?.dmToBookingRate ?? null,
      },
      // DashboardAggregator(nightly)が生成するKPIのうちKPI4枠(v2.0「KPIは4枠固定」)には
      // 含めない追加指標。来店人数/リピート率/指名率は画面②③④の前提データでもあるため、
      // 経営TOPでも参考値として併せて返す(必須4/KPI4の契約を変えない)。
      extendedKpi: {
        visitCount: snapshot?.visitCount ?? null,
        repeat30: snapshot?.repeat30 ?? null,
        repeat60: snapshot?.repeat60 ?? null,
        repeat90: snapshot?.repeat90 ?? null,
        nominationRate: snapshot?.nominationRate ?? null,
      },
      todayActions: snapshot?.aiInsights ?? [],
      salesTrend: trend.map((s) => ({
        snapshotDate: s.snapshotDate,
        monthlySales: s.monthlySales,
        forecastSales: s.forecastSales,
      })),
      csvImportStatus,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/admin/staff-analytics?storeId=...&date=... (画面④スタッフ分析・MD-4)
 *
 * brain_staff/brain_visits/brain_subscriptionsをその場で集計し、スタッフごとの
 * 売上/指名率/リピート率/LTV/成長率を返す
 * (StaffAnalyticsEngine.computeStaffAnalytics・決定論ルール・LLM不使用)。
 *
 * 設計契約(v2.0画面④・ユーザー指示2026-06-23): ランキング禁止・順位フィールド禁止・
 * 売上単体比較禁止(必ず指名率/リピート率等とセットで返す)・五十音順(近似)で返す。
 * 閲覧専用API(GETのみ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { staffAnalyticsQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { computeStaffAnalytics } from '@/lib/staffAnalytics/StaffAnalyticsEngine';
import { requireAdmin } from '@/lib/auth/requireAdmin';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

/**
 * month/dateが未指定の場合の基準日を決める(PHASE MD-2: 月選択デフォルト値問題の修正)。
 * brain_visitsの最新visit_dateの年月が実際の今日の年月と異なる場合(例: 実データが
 * 2026-06までしか無いのに今日は2026-07)、今日の年月をそのまま使うと当月売上0件・
 * 前月比較が常に−100%という実態と異なる表示になるため、最新データが存在する月を
 * 基準日として採用する。visitsが1件も無い場合は今日の日付のまま(変更なし)。
 */
function resolveDefaultAsOfDate(visits: { visitDate: string }[]): { date: string; autoSelectedLatestMonth: boolean } {
  const today = todayIso();
  if (visits.length === 0) {
    return { date: today, autoSelectedLatestMonth: false };
  }
  const latestVisitDate = visits.reduce((latest, v) => (v.visitDate > latest ? v.visitDate : latest), '');
  const latestYearMonth = latestVisitDate.slice(0, 7);
  const todayYearMonth = today.slice(0, 7);
  if (latestYearMonth === todayYearMonth) {
    return { date: today, autoSelectedLatestMonth: false };
  }
  return { date: lastDayOfMonth(latestYearMonth), autoSelectedLatestMonth: true };
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = staffAnalyticsQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    date: req.nextUrl.searchParams.get('date') ?? undefined,
    month: req.nextUrl.searchParams.get('month') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const { storeId } = parsed.data;
  const explicitDate = parsed.data.month ? lastDayOfMonth(parsed.data.month) : parsed.data.date;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [staff, visits, subscriptions] = await Promise.all([
      repos.staffRepo.listByStore(storeId),
      repos.visitRepo.listByStore(storeId),
      repos.subscriptionRepo.listByStore(storeId),
    ]);

    // month/dateの明示指定があればそれを最優先する(URLパラム優先・要件2)。
    // 指定が無い場合のみ、最新データが存在する月を自動選択する(要件1)。
    const { date, autoSelectedLatestMonth } = explicitDate
      ? { date: explicitDate, autoSelectedLatestMonth: false }
      : resolveDefaultAsOfDate(visits);

    const staffAnalytics = computeStaffAnalytics({ asOfDate: date, staff, visits, subscriptions });

    return NextResponse.json({ success: true, storeId, date, autoSelectedLatestMonth, staffAnalytics });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

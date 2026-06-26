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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const parsed = staffAnalyticsQuerySchema.safeParse({
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
    const [staff, visits, subscriptions] = await Promise.all([
      repos.staffRepo.listByStore(storeId),
      repos.visitRepo.listByStore(storeId),
      repos.subscriptionRepo.listByStore(storeId),
    ]);

    const staffAnalytics = computeStaffAnalytics({ asOfDate: date, staff, visits, subscriptions });

    return NextResponse.json({ success: true, storeId, date, staffAnalytics });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

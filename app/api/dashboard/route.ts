/**
 * GET /api/dashboard?storeId=... (GetDashboard)
 *
 * brain_dashboard_dailyの最新スナップショット1件(DashboardSnapshot)を返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../lib/repos';
import { storeIdQuerySchema } from '../_schemas/query';
import { toValidationErrorResponse } from '../_schemas/common';

export async function GET(req: NextRequest) {
  const parsed = storeIdQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const dashboard = await repos.dashboardRepo.latestByStore(parsed.data.storeId);
    if (!dashboard) {
      return NextResponse.json({ success: false, error: 'dashboard_not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, dashboard });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

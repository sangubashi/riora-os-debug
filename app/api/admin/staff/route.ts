/**
 * GET /api/admin/staff?storeId=... — スタッフ管理画面の一覧取得
 * STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1: brain_staffのみ利用(新規テーブルなし)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { requireAdmin } from '@/lib/auth/requireAdmin';

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
    const staff = await repos.staffRepo.listByStore(storeId);
    return NextResponse.json({ success: true, staff });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

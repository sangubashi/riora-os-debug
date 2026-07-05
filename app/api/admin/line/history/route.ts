/**
 * GET /api/admin/line/history — 配信履歴(Pass G)
 *
 * line_send_queue(実データ)の送信済み一覧を返す(成功/失敗を含む)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/repos';
import { listDeliveryHistory } from '@/lib/line/lineAdminQueries';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const history = await listDeliveryHistory(supabase);
    return NextResponse.json({ success: true, history });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

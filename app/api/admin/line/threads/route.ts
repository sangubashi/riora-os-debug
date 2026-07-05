/**
 * GET /api/admin/line/threads — LINEチャット一覧(Pass G)
 *
 * line_send_logs(実データ・Webhook受信ログ+送信実行ログ)をrecipient_idで集約して返す。
 * line_logsの架空データは使用しない(docs/LINE画面_DB調査レポート.md参照)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/repos';
import { listLineThreads } from '@/lib/line/lineAdminQueries';
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
    const threads = await listLineThreads(supabase);
    return NextResponse.json({ success: true, threads });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

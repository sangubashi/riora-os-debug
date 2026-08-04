/**
 * GET /api/admin/line/threads — LINEチャット一覧(Pass G)
 *
 * line_send_logs(実データ・Webhook受信ログ+送信実行ログ)をrecipient_idで集約して返す。
 * line_logsの架空データは使用しない(docs/LINE画面_DB調査レポート.md参照)。
 *
 * requireAdminではなくextractStaffFromRequestのみ(isAdmin不問)なのは意図的:
 * 一般スタッフの「今日」タブ未読バッジ(useLineUnreadStore)からも呼ばれるため。
 * STAFF_PERMISSION_AUDIT_1: 以前はisAdminを問わず店舗全件(他顧客のLINE本文含む)を
 * 返していたが、listLineThreads()側でscope(担当範囲)による絞り込みを追加した
 * (docs/STAFF_PERMISSION_AUDIT.md参照)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/repos';
import { listLineThreads } from '@/lib/line/lineAdminQueries';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    // STAFF_PERMISSION_AUDIT_1: adminは店舗全件(管理画面ChatListTab.tsx用)、
    // 一般スタッフは担当範囲のみ(今日タブの未読バッジ用)に絞る。
    const threads = await listLineThreads(supabase, {
      staffBrainId: staff.staffBrainId,
      isAdmin: staff.isAdmin,
    });
    return NextResponse.json({ success: true, threads });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

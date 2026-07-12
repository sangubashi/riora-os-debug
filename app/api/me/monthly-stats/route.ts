/**
 * GET /api/me/monthly-stats
 *
 * 「わたしタブ」用API。ログイン中のスタッフ本人の実績のみを、
 * 今月 vs 先月の差分（事実の増減）として返す。他スタッフとの比較・
 * ランキング・順位は一切含まない（Riora OS v1.0 再設計書 準拠）。
 *
 * 返却フィールド:
 *   nominationDiff     今月の指名来店数 − 先月の指名来店数
 *   repeatRateDiff     今月のリピート率(%) − 先月のリピート率(%)
 *   visitCountDiff     今月の来店数 − 先月の来店数
 *   reviewCount        口コミ件数（未実装。DBにテーブルが存在しないため常に null）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

const STORE_ID = '00000000-0000-0000-0000-000000000001';

function monthStart(offsetMonths: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().split('T')[0];
}

interface VisitRow {
  visit_date:     string;
  is_nomination:  boolean | null;
  visit_count_at: number | null;
}

function summarize(rows: VisitRow[]) {
  const visitCount      = rows.length;
  const nominationCount = rows.filter(r => r.is_nomination).length;
  const repeatCount     = rows.filter(r => (r.visit_count_at ?? 0) > 1).length;
  const repeatRate      = visitCount > 0 ? Math.round((repeatCount / visitCount) * 100) : 0;
  return { visitCount, nominationCount, repeatRate };
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 管理者(owner)アカウントはbrain_staff行を持たずstaffBrainId=nullのため、
  // staff_idクエリを実行すると常に0件になってしまう(PHASE MYPAGE-AUDIT-1で特定)。
  // 誤った0表示を返す前にここで弾く。
  if (staff.isAdmin || !staff.staffBrainId) {
    return NextResponse.json(
      { error: 'admin_not_supported', message: '管理者アカウントではご利用いただけません。スタッフアカウントでログインしてください。' },
      { status: 400 }
    );
  }

  try {
    const supabase = getServiceClient();

    const thisMonthStart = monthStart(0);
    const lastMonthStart = monthStart(-1);
    // 「先月」の終端は「今月開始日の前日」
    const lastMonthEnd = new Date(thisMonthStart);
    lastMonthEnd.setDate(lastMonthEnd.getDate() - 1);
    const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('brain_visits')
      .select('visit_date, is_nomination, visit_count_at')
      .eq('store_id', STORE_ID)
      .eq('staff_id', staff.staffBrainId)
      .gte('visit_date', lastMonthStart)
      .is('deleted_at', null);

    if (error) throw error;

    const rows = (data ?? []) as VisitRow[];
    const thisMonthRows = rows.filter(r => r.visit_date >= thisMonthStart);
    const lastMonthRows = rows.filter(r => r.visit_date >= lastMonthStart && r.visit_date <= lastMonthEndStr);

    const thisMonth = summarize(thisMonthRows);
    const lastMonth = summarize(lastMonthRows);

    return NextResponse.json({
      nominationDiff: thisMonth.nominationCount - lastMonth.nominationCount,
      repeatRateDiff: thisMonth.repeatRate - lastMonth.repeatRate,
      visitCountDiff: thisMonth.visitCount - lastMonth.visitCount,
      reviewCount:    null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

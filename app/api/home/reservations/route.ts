/**
 * GET /api/home/reservations
 *
 * service role でRLSをバイパスし、今日の brain_customer_id 連携済み予約を返す。
 *
 * 仕様:
 *   - 今日の予約のみ返す（フォールバックなし）
 *   - 今日0件 → reservations: [] を返す（画面側で「本日の予約はありません」表示）
 *   - status='cancelled'の予約は除外する(Phase 1-F修正版)
 *   - 同一 brain_customer_id が重複する場合はcreated_at最新の1件を残す(Phase 1-F修正版。
 *     リスケジュール等でscheduled_atが変わった場合に古い時刻の行が優先される不具合の修正)。
 *     表示自体はscheduled_at昇順のまま。
 *
 * Query params:
 *   role  — 'owner' | 'staff'
 *   uid   — staff の場合は staff_id でフィルタ
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

function todayJst(): { start: string; end: string } {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const date = jst.toISOString().split('T')[0];
  return {
    start: `${date}T00:00:00+09:00`,
    end:   `${date}T23:59:59+09:00`,
  };
}

const RESERVATION_SELECT = `
  id,
  brain_customer_id,
  staff_id,
  menu,
  price,
  scheduled_at,
  duration_minutes,
  status,
  is_new_customer,
  notes,
  created_at,
  brain_customer:brain_customers!brain_customer_id (
    id,
    name,
    customer_type,
    churn_score,
    is_subscriber,
    skin_tags
  )
` as const;

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();
    const { start, end } = todayJst();

    // 今日の予約（brain_customer_id 連携済み・キャンセル除く）
    // 管理者は全スタッフ分、スタッフは自分の担当分のみ
    // 同一顧客の重複排除(直後)でcreated_at最新を優先するため、取得順はcreated_at降順にする。
    let query = supabase
      .from('reservations')
      .select(RESERVATION_SELECT)
      .not('brain_customer_id', 'is', null)
      .neq('status', 'cancelled')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('created_at', { ascending: false });

    if (!staff.isAdmin) {
      // reservations.staff_id は profiles.id (= auth.users.id) を格納する。
      // brain_staff.id (staffBrainId) とは別物のため authUserId で比較する。
      query = query.eq('staff_id', staff.authUserId);
    }

    const { data, error } = await query.limit(50);
    if (error) return NextResponse.json({ error: String(error) }, { status: 500 });

    // brain_customer が null のものを除外
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = (data ?? []).filter((r: any) => r.brain_customer != null);

    // 同一顧客・同日に複数予約がある場合(リスケジュール等)はcreated_at最新の1件のみ残す。
    // 取得順が既にcreated_at降順のため、先頭1件を残すだけでよい。
    const seen = new Set<string>();
    const deduped = valid.filter((r: { brain_customer_id: string }) => {
      if (seen.has(r.brain_customer_id)) return false;
      seen.add(r.brain_customer_id);
      return true;
    });

    // 画面表示は来店時刻順(scheduled_at昇順)へ並び替える。
    const reservations = deduped.sort(
      (a: { scheduled_at: string }, b: { scheduled_at: string }) =>
        new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    );

    return NextResponse.json({ reservations });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

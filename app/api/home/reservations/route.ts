/**
 * GET /api/home/reservations
 *
 * service role でRLSをバイパスし、今日の brain_customer_id 連携済み予約を返す。
 *
 * 仕様:
 *   - 今日の予約のみ返す（フォールバックなし）
 *   - 今日0件 → reservations: [] を返す（画面側で「本日の予約はありません」表示）
 *   - 追加で cancelledToday を返す(2026-10-01・当日キャンセル機能): status='cancelled'のうち
 *     cancelled_at(キャンセル日時)が本日(JST)のもの。通常のreservationsには含めない。
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
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants';

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
    skin_tags,
    is_internal_user
  )
` as const;

// 当日キャンセル欄用: RESERVATION_SELECT + キャンセル情報(cancelled_at / cancel_source)。
// 通常予約のクエリ(RESERVATION_SELECT)は未変更(新カラム未適用でも壊れないようにするため)。
const CANCELLED_SELECT = `
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
  cancelled_at,
  cancel_source,
  brain_customer:brain_customers!brain_customer_id (
    id,
    name,
    customer_type,
    churn_score,
    is_subscriber,
    skin_tags,
    is_internal_user
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

    // iPad店舗共通ログイン(2026-09-20ユーザー承認)は特定の担当者に紐づかないため、
    // adminと同様に本日の全予約を返す(絞り込まない)。この1クエリのみの例外で、
    // isAdminフラグ自体は変更しないため他のadmin専用機能への影響はない。
    if (!staff.isAdmin && staff.authUserId !== SHARED_IPAD_STAFF_USER_ID) {
      // reservations.staff_id は profiles.id (= auth.users.id) を格納する。
      // brain_staff.id (staffBrainId) とは別物のため authUserId で比較する。
      query = query.eq('staff_id', staff.authUserId);
    }

    const { data, error } = await query.limit(50);
    if (error) return NextResponse.json({ error: String(error) }, { status: 500 });

    // brain_customer が null のものを除外。あわせて内部ユーザー(is_internal_user=true。
    // スタッフ本人の試用・検証購入等)はスタッフアプリの「今日の来店」から完全に除外する。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = (data ?? []).filter((r: any) => r.brain_customer != null && !r.brain_customer.is_internal_user);

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

    // 当日キャンセル(2026-10-01・/karteの「当日キャンセル」欄用): 「予約日が今日」ではなく
    // 「キャンセルされた日時(cancelled_at)が今日(JST)」の予約を別配列で返す。通常の
    // reservationsには一切影響しない(status<>'cancelled'の既存仕様のまま)。
    // cancelled_at列が未適用などで失敗しても、通常予約の返却は壊さず空配列で継続する。
    let cancelledToday: unknown[] = [];
    try {
      let cancelledQuery = supabase
        .from('reservations')
        .select(CANCELLED_SELECT)
        .not('brain_customer_id', 'is', null)
        .eq('status', 'cancelled')
        .gte('cancelled_at', start)
        .lte('cancelled_at', end)
        .order('cancelled_at', { ascending: false });
      if (!staff.isAdmin && staff.authUserId !== SHARED_IPAD_STAFF_USER_ID) {
        cancelledQuery = cancelledQuery.eq('staff_id', staff.authUserId);
      }
      const { data: cancelledData, error: cancelledError } = await cancelledQuery.limit(50);
      if (cancelledError) {
        console.error('[home/reservations] cancelledToday query failed:', cancelledError.message);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cancelledToday = (cancelledData ?? []).filter((r: any) => r.brain_customer != null && !r.brain_customer.is_internal_user);
      }
    } catch (e) {
      console.error('[home/reservations] cancelledToday failed:', e);
    }

    return NextResponse.json({ reservations, cancelledToday });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

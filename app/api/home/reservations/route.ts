/**
 * GET /api/home/reservations
 *
 * service role でRLSをバイパスし、今日の brain_customer_id 連携済み予約を返す。
 *
 * 仕様:
 *   - 今日の予約のみ返す（フォールバックなし）
 *   - 今日0件 → reservations: [] を返す（画面側で「本日の予約はありません」表示）
 *   - 同一 brain_customer_id が重複する場合は最初の1件（scheduled_at 昇順）を残す
 *
 * Query params:
 *   role  — 'owner' | 'staff'
 *   uid   — staff の場合は staff_id でフィルタ
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';

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
    is_subscriber
  )
` as const;

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const role = params.get('role') ?? 'owner';
    const uid  = params.get('uid')  ?? '';

    const supabase = getServiceClient();
    const { start, end } = todayJst();

    // 今日の予約（brain_customer_id 連携済みのみ、時刻昇順）
    let query = supabase
      .from('reservations')
      .select(RESERVATION_SELECT)
      .not('brain_customer_id', 'is', null)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: true });

    if (role === 'staff' && uid) {
      query = query.eq('staff_id', uid);
    }

    const { data, error } = await query.limit(50);
    if (error) return NextResponse.json({ error: String(error) }, { status: 500 });

    // brain_customer が null のものを除外
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = (data ?? []).filter((r: any) => r.brain_customer != null);

    // 同一 brain_customer_id の重複を排除（先頭1件を残す）
    const seen = new Set<string>();
    const reservations = valid.filter((r: { brain_customer_id: string }) => {
      if (seen.has(r.brain_customer_id)) return false;
      seen.add(r.brain_customer_id);
      return true;
    });

    return NextResponse.json({ reservations });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

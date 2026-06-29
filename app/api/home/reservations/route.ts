/**
 * GET /api/home/reservations
 *
 * service role でRLSをバイパスし、brain_customer_id 連携済み予約を返す。
 * Supabase anon クライアントでは brain_customers RLS（app_store_id() = NULL）
 * によりJOINが0件になるため、このAPIを経由して取得する。
 *
 * Query params:
 *   role  — 'owner' | 'staff'
 *   uid   — staff の場合は staff_id でフィルタ
 *
 * Response:
 *   { reservations: ReservationWithBrainCustomer[], isFallback: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';

const STORE_ID = '00000000-0000-0000-0000-000000000001';

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

    // ── 今日の予約（brain_customer_id 連携済みのみ）─────────────────────
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reservations = (data ?? []).filter((r: any) => r.brain_customer != null);
    let isFallback = false;

    if (reservations.length === 0) {
      // ── 今日の予約なし → 最新5件フォールバック ────────────────────────
      let fallbackQuery = supabase
        .from('reservations')
        .select(RESERVATION_SELECT)
        .not('brain_customer_id', 'is', null)
        .order('scheduled_at', { ascending: false })
        .limit(5);

      if (role === 'staff' && uid) {
        fallbackQuery = fallbackQuery.eq('staff_id', uid);
      }

      const { data: fallbackData, error: fallbackError } = await fallbackQuery;
      if (!fallbackError && fallbackData) {
        reservations = (fallbackData as typeof fallbackData)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((r: any) => r.brain_customer != null)
          .sort((a: { scheduled_at: string }, b: { scheduled_at: string }) =>
            a.scheduled_at.localeCompare(b.scheduled_at)
          );
        isFallback = reservations.length > 0;
      }
    }

    return NextResponse.json({ reservations, isFallback });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

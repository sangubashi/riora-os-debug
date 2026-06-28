/**
 * GET /api/kpi/summary
 * brain_visits / brain_staff から KPI 集計を返す（service role 経由・RLS bypass）。
 * 外部認証不要。クライアント側 anon key では brain_* にアクセス不可のため、
 * このルートを経由する。
 */
import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';

const STORE_ID = '00000000-0000-0000-0000-000000000001';

function isoToday() { return new Date().toISOString().split('T')[0]; }
function monthStart() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split('T')[0];
}
function weekAgo() {
  const d = new Date(); d.setDate(d.getDate() - 6);
  return d.toISOString().split('T')[0];
}

export async function GET() {
  try {
    const supabase = getServiceClient();
    const today  = isoToday();
    const mStart = monthStart();
    const wStart = weekAgo();

    const [todayRes, monthRes, weekRes, staffRes, staffVisitRes] = await Promise.allSettled([
      supabase
        .from('brain_visits')
        .select('treatment_amount, retail_amount')
        .eq('store_id', STORE_ID)
        .eq('visit_date', today)
        .is('deleted_at', null),

      supabase
        .from('brain_visits')
        .select('treatment_amount, retail_amount, is_nomination, next_booking_made')
        .eq('store_id', STORE_ID)
        .gte('visit_date', mStart)
        .is('deleted_at', null),

      supabase
        .from('brain_visits')
        .select('visit_date, treatment_amount, retail_amount')
        .eq('store_id', STORE_ID)
        .gte('visit_date', wStart)
        .is('deleted_at', null)
        .order('visit_date', { ascending: true }),

      supabase
        .from('brain_staff')
        .select('id, name')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),

      supabase
        .from('brain_visits')
        .select('staff_id, treatment_amount, retail_amount, is_nomination')
        .eq('store_id', STORE_ID)
        .gte('visit_date', mStart)
        .is('deleted_at', null),
    ]);

    // 本日売上
    const todayRows = todayRes.status === 'fulfilled' ? (todayRes.value.data ?? []) : [];
    const todaySales = todayRows.reduce(
      (s, r) => s + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0
    );

    // 今月集計
    const monthRows = monthRes.status === 'fulfilled' ? (monthRes.value.data ?? []) : [];
    const monthlySales = monthRows.reduce(
      (s, r) => s + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0
    );
    const nominationCount = monthRows.filter(r => r.is_nomination).length;
    const nextBookingRate = monthRows.length > 0
      ? Math.round(monthRows.filter(r => r.next_booking_made).length / monthRows.length * 100)
      : 0;

    // 週次売上
    const weekRows = weekRes.status === 'fulfilled' ? (weekRes.value.data ?? []) : [];
    const salesByDate: Record<string, number> = {};
    for (const r of weekRows) {
      salesByDate[r.visit_date] = (salesByDate[r.visit_date] ?? 0)
        + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0);
    }
    const weeklySales = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const date = d.toISOString().split('T')[0];
      return { date, sales: salesByDate[date] ?? 0 };
    });

    // 個人実績
    const staffList  = staffRes.status       === 'fulfilled' ? (staffRes.value.data ?? [])      : [];
    const staffVisits = staffVisitRes.status === 'fulfilled' ? (staffVisitRes.value.data ?? []) : [];

    const perfMap: Record<string, { visitCount: number; totalSales: number; nominations: number }> = {};
    for (const v of staffVisits) {
      const ex = perfMap[v.staff_id] ?? { visitCount: 0, totalSales: 0, nominations: 0 };
      ex.visitCount++;
      ex.totalSales += (v.treatment_amount ?? 0) + (v.retail_amount ?? 0);
      if (v.is_nomination) ex.nominations++;
      perfMap[v.staff_id] = ex;
    }

    const staffPerformance = staffList
      .map(s => ({
        staffId:    s.id,
        staffName:  s.name,
        visitCount: perfMap[s.id]?.visitCount  ?? 0,
        totalSales: perfMap[s.id]?.totalSales  ?? 0,
        nominations: perfMap[s.id]?.nominations ?? 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales);

    return NextResponse.json({
      todaySales,
      monthlySales,
      nominationCount,
      nextBookingRate,
      weeklySales,
      staffPerformance,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

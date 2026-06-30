/**
 * GET /api/kpi/summary
 * brain_visits / brain_customers / brain_staff から KPI 集計を返す。
 * service role 経由（RLS bypass）。外部認証不要。
 *
 * 返却フィールド:
 *   todaySales       brain_visits.visit_date = today の売上合計
 *   yesterdaySales   brain_visits.visit_date = yesterday の売上合計
 *   monthlySales     brain_visits.visit_date >= 月初 の売上合計
 *   nominationCount  今月の指名来店数
 *   nextBookingRate  次回予約率 (%)
 *   todayVisitCount  本日の来店件数 (brain_visits)
 *   churnRiskCount   最終来院 > 90日 or 来院なし の顧客数 (brain_customers + brain_visits)
 *   activeCustomerCount brain_customers アクティブ件数
 *   weeklySales      直近7日の日別売上配列
 *   staffPerformance スタッフ別月次実績
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

const STORE_ID = '00000000-0000-0000-0000-000000000001';
const CHURN_DAYS = 90;

function isoToday()     { return new Date().toISOString().split('T')[0]; }
function isoYesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
function monthStart() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split('T')[0];
}
function weekAgo() {
  const d = new Date(); d.setDate(d.getDate() - 6);
  return d.toISOString().split('T')[0];
}
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase  = getServiceClient();
    const today     = isoToday();
    const yesterday = isoYesterday();
    const mStart    = monthStart();
    const wStart    = weekAgo();
    const churnCutoff = daysAgoStr(CHURN_DAYS);

    const [
      todayRes,
      yesterdayRes,
      monthRes,
      weekRes,
      staffRes,
      staffVisitRes,
      lastVisitRes,
      customerRes,
    ] = await Promise.allSettled([
      // 本日売上
      supabase
        .from('brain_visits')
        .select('treatment_amount, retail_amount')
        .eq('store_id', STORE_ID)
        .eq('visit_date', today)
        .is('deleted_at', null),

      // 昨日売上
      supabase
        .from('brain_visits')
        .select('treatment_amount, retail_amount')
        .eq('store_id', STORE_ID)
        .eq('visit_date', yesterday)
        .is('deleted_at', null),

      // 今月集計
      supabase
        .from('brain_visits')
        .select('treatment_amount, retail_amount, is_nomination, next_booking_made')
        .eq('store_id', STORE_ID)
        .gte('visit_date', mStart)
        .is('deleted_at', null),

      // 週次売上
      supabase
        .from('brain_visits')
        .select('visit_date, treatment_amount, retail_amount')
        .eq('store_id', STORE_ID)
        .gte('visit_date', wStart)
        .is('deleted_at', null)
        .order('visit_date', { ascending: true }),

      // スタッフ一覧
      supabase
        .from('brain_staff')
        .select('id, name')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),

      // 今月スタッフ別実績
      supabase
        .from('brain_visits')
        .select('staff_id, treatment_amount, retail_amount, is_nomination')
        .eq('store_id', STORE_ID)
        .gte('visit_date', mStart)
        .is('deleted_at', null),

      // 全顧客の最終来院日（チャーン計算用）
      supabase
        .from('brain_visits')
        .select('customer_id, visit_date')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),

      // アクティブ顧客一覧（id のみ）
      supabase
        .from('brain_customers')
        .select('id')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),
    ]);

    // ── 本日売上 ────────────────────────────────────────────────
    const todayRows = todayRes.status === 'fulfilled' ? (todayRes.value.data ?? []) : [];
    const todaySales = todayRows.reduce(
      (s, r) => s + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0
    );
    const todayVisitCount = todayRows.length;

    // ── 昨日売上 ────────────────────────────────────────────────
    const yesterdayRows = yesterdayRes.status === 'fulfilled' ? (yesterdayRes.value.data ?? []) : [];
    const yesterdaySales = yesterdayRows.reduce(
      (s, r) => s + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0
    );

    // ── 今月集計 ────────────────────────────────────────────────
    const monthRows = monthRes.status === 'fulfilled' ? (monthRes.value.data ?? []) : [];
    const monthlySales = monthRows.reduce(
      (s, r) => s + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0
    );
    const nominationCount  = monthRows.filter(r => r.is_nomination).length;
    const nextBookingRate  = monthRows.length > 0
      ? Math.round(monthRows.filter(r => r.next_booking_made).length / monthRows.length * 100)
      : 0;

    // ── 週次売上 ────────────────────────────────────────────────
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

    // ── スタッフ別実績 ───────────────────────────────────────────
    const staffList   = staffRes.status       === 'fulfilled' ? (staffRes.value.data   ?? []) : [];
    const staffVisits = staffVisitRes.status  === 'fulfilled' ? (staffVisitRes.value.data ?? []) : [];
    const perfMap: Record<string, { visitCount: number; totalSales: number; nominations: number }> = {};
    for (const v of staffVisits) {
      const ex = perfMap[v.staff_id] ?? { visitCount: 0, totalSales: 0, nominations: 0 };
      ex.visitCount++;
      ex.totalSales  += (v.treatment_amount ?? 0) + (v.retail_amount ?? 0);
      if (v.is_nomination) ex.nominations++;
      perfMap[v.staff_id] = ex;
    }
    const staffPerformance = staffList
      .filter(s => staff.isAdmin || s.id === staff.staffBrainId)
      .map(s => ({
        staffId:     s.id,
        staffName:   s.name,
        visitCount:  perfMap[s.id]?.visitCount  ?? 0,
        totalSales:  perfMap[s.id]?.totalSales  ?? 0,
        nominations: perfMap[s.id]?.nominations ?? 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales);

    // ── チャーン顧客数 ───────────────────────────────────────────
    // brain_visits の全来院データから顧客ごとの最終来院日を算出し、
    // 90日以上来院なし OR 来院記録なし の brain_customers 数をカウント。
    const lastVisitRows = lastVisitRes.status === 'fulfilled' ? (lastVisitRes.value.data ?? []) : [];
    const lastVisitByCustomer: Record<string, string> = {};
    for (const v of lastVisitRows) {
      if (!lastVisitByCustomer[v.customer_id] || v.visit_date > lastVisitByCustomer[v.customer_id]) {
        lastVisitByCustomer[v.customer_id] = v.visit_date;
      }
    }

    const allCustomers    = customerRes.status === 'fulfilled' ? (customerRes.value.data ?? []) : [];
    const activeCustomerCount = allCustomers.length;
    let churnRiskCount = 0;
    for (const c of allCustomers) {
      const lastVisit = lastVisitByCustomer[c.id];
      if (!lastVisit || lastVisit < churnCutoff) {
        churnRiskCount++;
      }
    }

    // ── リピート率 ──────────────────────────────────────────────────
    // 過去365日で2回以上来院した顧客数 / アクティブ顧客数
    const yearAgo = daysAgoStr(365);
    const visitCountByCustomer: Record<string, number> = {};
    for (const v of lastVisitRows) {
      if (v.visit_date >= yearAgo) {
        visitCountByCustomer[v.customer_id] = (visitCountByCustomer[v.customer_id] ?? 0) + 1;
      }
    }
    const repeatCustomerCount = Object.values(visitCountByCustomer).filter(n => n >= 2).length;
    const repeatRate = activeCustomerCount > 0
      ? Math.round(repeatCustomerCount / activeCustomerCount * 100)
      : 0;

    // ── 客単価 ──────────────────────────────────────────────────────
    // 今月の来院1件あたり平均売上
    const avgSpend = monthRows.length > 0
      ? Math.round(monthlySales / monthRows.length)
      : 0;

    // ── 来店周期 ─────────────────────────────────────────────────────
    // 顧客ごとの来院間隔（日数）の平均
    const visitDatesByCustomer: Record<string, string[]> = {};
    for (const v of lastVisitRows) {
      if (!visitDatesByCustomer[v.customer_id]) visitDatesByCustomer[v.customer_id] = [];
      visitDatesByCustomer[v.customer_id].push(v.visit_date);
    }
    const intervals: number[] = [];
    for (const dates of Object.values(visitDatesByCustomer)) {
      if (dates.length < 2) continue;
      dates.sort();
      for (let i = 1; i < dates.length; i++) {
        const diff = Math.round(
          (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86_400_000
        );
        if (diff > 0) intervals.push(diff);
      }
    }
    const visitCycleDays = intervals.length > 0
      ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : 0;

    return NextResponse.json({
      todaySales,
      yesterdaySales,
      monthlySales,
      nominationCount,
      nextBookingRate,
      todayVisitCount,
      churnRiskCount,
      activeCustomerCount,
      weeklySales,
      staffPerformance,
      repeatRate,
      avgSpend,
      visitCycleDays,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

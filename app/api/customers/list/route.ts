/**
 * GET /api/customers/list
 * brain_customers + brain_visits + brain_staff から顧客一覧を返す。
 * service role 経由（RLS bypass）。
 */
import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';

const STORE_ID = '00000000-0000-0000-0000-000000000001';

const BRAIN_TYPE_MAP: Record<string, string> = {
  'A_acne':      '効果重視型',
  'B_pore':      '効果重視型',
  'C_sensitive': '慎重・不安型',
  'D_aging':     'VIP型',
};
const VALID_TYPES = new Set(['VIP型', '慎重・不安型', '感情重視型', '効果重視型', '信頼構築型']);

function resolveType(t: string | null): string {
  if (!t) return '信頼構築型';
  if (BRAIN_TYPE_MAP[t]) return BRAIN_TYPE_MAP[t];
  if (VALID_TYPES.has(t)) return t;
  return '信頼構築型';
}

export async function GET() {
  try {
    const supabase = getServiceClient();

    const [custRes, visitRes, staffRes] = await Promise.allSettled([
      supabase
        .from('brain_customers')
        .select('id, name, customer_type, churn_score, assigned_staff_id, first_visit_date, is_subscriber')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null)
        .order('name'),

      supabase
        .from('brain_visits')
        .select('customer_id, treatment_amount, retail_amount, visit_date')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),

      supabase
        .from('brain_staff')
        .select('id, name')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),
    ]);

    const customers = custRes.status   === 'fulfilled' ? (custRes.value.data   ?? []) : [];
    const visits    = visitRes.status  === 'fulfilled' ? (visitRes.value.data  ?? []) : [];
    const staffList = staffRes.status  === 'fulfilled' ? (staffRes.value.data  ?? []) : [];

    // 来店集計マップ
    const visitStats: Record<string, { visitCount: number; totalSpent: number; lastVisitDate: string | null }> = {};
    for (const v of visits) {
      const ex = visitStats[v.customer_id] ?? { visitCount: 0, totalSpent: 0, lastVisitDate: null };
      ex.visitCount++;
      ex.totalSpent += (v.treatment_amount ?? 0) + (v.retail_amount ?? 0);
      if (!ex.lastVisitDate || v.visit_date > ex.lastVisitDate) ex.lastVisitDate = v.visit_date;
      visitStats[v.customer_id] = ex;
    }

    // スタッフ名マップ
    const staffMap: Record<string, string> = {};
    for (const s of staffList) staffMap[s.id] = s.name;

    const rows = customers.map(c => {
      const stats       = visitStats[c.id] ?? { visitCount: 0, totalSpent: 0, lastVisitDate: null };
      const type        = resolveType(c.customer_type);
      const lastVisit   = stats.lastVisitDate
        ? Math.max(0, Math.floor((Date.now() - new Date(stats.lastVisitDate).getTime()) / 86_400_000))
        : 0;
      return {
        id:               c.id,
        name:             c.name,
        type,
        visitCount:       stats.visitCount,
        totalSpent:       stats.totalSpent,
        churnRisk:        Number(c.churn_score) || 0,
        lastVisit,
        lastVisitDate:    stats.lastVisitDate,
        isVip:            type === 'VIP型' || stats.totalSpent >= 100000,
        assignedStaffId:  c.assigned_staff_id ?? null,
        treatments:       [] as string[],
        staffName:        c.assigned_staff_id ? (staffMap[c.assigned_staff_id] ?? '') : '',
        lineResponseRate: 50,
        hasNextRebook:    false,
      };
    }).sort((a, b) => b.totalSpent - a.totalSpent);

    return NextResponse.json({ customers: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/customers/list
 * brain_customers + brain_visits + brain_staff から顧客一覧を返す。
 * service role 経由（RLS bypass）。
 * Authorization: Bearer <token> 必須。
 * 担当判定は AUTH-1 V2（canAccessCustomer.ts の Rule A'/B'/C）に準拠。
 * assignedStaffId/staffName の表示値も直近来店(Rule A')基準（旧assigned_staff_idは不使用）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { filterAccessibleCustomerIds } from '@/lib/auth/canAccessCustomer';

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

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getServiceClient();

    const [custRes, visitRes, staffRes] = await Promise.allSettled([
      supabase
        .from('brain_customers')
        .select('id, name, customer_type, churn_score, first_visit_date, is_subscriber')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null)
        .order('name'),

      supabase
        .from('brain_visits')
        .select('customer_id, staff_id, treatment_amount, retail_amount, visit_date')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null)
        .order('visit_date', { ascending: false }),

      supabase
        .from('brain_staff')
        .select('id, name')
        .eq('store_id', STORE_ID)
        .is('deleted_at', null),
    ]);

    const allCustomers = custRes.status   === 'fulfilled' ? (custRes.value.data   ?? []) : [];
    const visits       = visitRes.status  === 'fulfilled' ? (visitRes.value.data  ?? []) : [];
    const staffList    = staffRes.status  === 'fulfilled' ? (staffRes.value.data  ?? []) : [];

    // 担当顧客 + NULL(共有)顧客のみに絞る
    const accessibleIds = await filterAccessibleCustomerIds(
      allCustomers.map((c: { id: string }) => c.id),
      staff.staffBrainId,
      staff.isAdmin,
    )
    const customers = allCustomers.filter((c: { id: string }) => accessibleIds.has(c.id));

    // 来店集計マップ（AUTH1 V2 Rule A': 直近来店(visit_date最新)のstaff_idを「担当」表示に採用。
    // visitsはvisit_date降順で取得済みのため、顧客ごとに最初に出現したstaff_idが最新来店の担当。
    // assigned_staff_id(書き込み経路なし・カバー率54%)はもう担当表示の根拠に使わない。
    const visitStats: Record<string, { visitCount: number; totalSpent: number; lastVisitDate: string | null; latestStaffId: string | null }> = {};
    for (const v of visits) {
      const ex = visitStats[v.customer_id] ?? { visitCount: 0, totalSpent: 0, lastVisitDate: null, latestStaffId: null };
      ex.visitCount++;
      ex.totalSpent += (v.treatment_amount ?? 0) + (v.retail_amount ?? 0);
      if (!ex.lastVisitDate || v.visit_date > ex.lastVisitDate) {
        ex.lastVisitDate  = v.visit_date;
        ex.latestStaffId  = v.staff_id ?? null;
      }
      visitStats[v.customer_id] = ex;
    }

    // スタッフ名マップ
    const staffMap: Record<string, string> = {};
    for (const s of staffList) staffMap[s.id] = s.name;

    const rows = customers.map(c => {
      const stats       = visitStats[c.id] ?? { visitCount: 0, totalSpent: 0, lastVisitDate: null, latestStaffId: null };
      const type        = resolveType(c.customer_type);
      const lastVisit   = stats.lastVisitDate
        ? Math.max(0, Math.floor((Date.now() - new Date(stats.lastVisitDate).getTime()) / 86_400_000))
        : 0;
      // AUTH1 V2 Rule A': 「担当」表示は直近来店staff_id基準（旧assigned_staff_idは不使用）
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
        assignedStaffId:  stats.latestStaffId,
        treatments:       [] as string[],
        staffName:        stats.latestStaffId ? (staffMap[stats.latestStaffId] ?? '') : '',
        lineResponseRate: 0,
        hasNextRebook:    false,
      };
    }).sort((a, b) => b.totalSpent - a.totalSpent);

    return NextResponse.json({ customers: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

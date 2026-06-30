/**
 * GET /api/customers/brain-stats?names=name1,name2,...
 *
 * 顧客名リストを受け取り、brain_customers + brain_visits から
 * 来店回数・累計売上・最終来院日・VIP判定 を返す。
 * service role 経由（RLS bypass）。
 *
 * 名前マッチが見つからない場合はその名前をキーから除外して返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { filterAccessibleCustomerIds } from '@/lib/auth/canAccessCustomer';

const STORE_ID  = '00000000-0000-0000-0000-000000000001';
const VIP_SPEND = 100_000;

export interface CustomerBrainStats {
  visitCount:    number
  totalSpent:    number
  lastVisitDate: string | null
  churnScore:    number          // 0–1
  isVip:         boolean
  customerType:  string | null
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const raw   = req.nextUrl.searchParams.get('names') ?? '';
  const names = raw.split(',').map(n => n.trim()).filter(Boolean);

  if (names.length === 0) {
    return NextResponse.json({ stats: {} });
  }

  try {
    const supabase = getServiceClient();

    // brain_customers を名前一括検索
    const { data: customers } = await supabase
      .from('brain_customers')
      .select('id, name, customer_type, churn_score')
      .eq('store_id', STORE_ID)
      .in('name', names)
      .is('deleted_at', null);

    if (!customers || customers.length === 0) {
      return NextResponse.json({ stats: {} });
    }

    // アクセス可能な顧客のみ対象に絞る
    const accessibleIds = await filterAccessibleCustomerIds(
      customers.map((c: { id: string }) => c.id),
      staff.staffBrainId,
      staff.isAdmin,
    )
    const accessibleCustomers = customers.filter((c: { id: string }) => accessibleIds.has(c.id))
    if (accessibleCustomers.length === 0) return NextResponse.json({ stats: {} })

    const customerIds = accessibleCustomers.map((c: { id: string }) => c.id);

    // brain_visits を対象顧客で一括取得
    const { data: visits } = await supabase
      .from('brain_visits')
      .select('customer_id, treatment_amount, retail_amount, visit_date')
      .in('customer_id', customerIds)
      .is('deleted_at', null);

    // 顧客IDごとに集計
    const agg: Record<string, { visitCount: number; totalSpent: number; lastVisitDate: string | null }> = {};
    for (const v of (visits ?? [])) {
      const ex = agg[v.customer_id] ?? { visitCount: 0, totalSpent: 0, lastVisitDate: null };
      ex.visitCount++;
      ex.totalSpent += (v.treatment_amount ?? 0) + (v.retail_amount ?? 0);
      if (!ex.lastVisitDate || v.visit_date > ex.lastVisitDate) ex.lastVisitDate = v.visit_date;
      agg[v.customer_id] = ex;
    }

    // 名前キーで返却 (同名顧客が複数いる場合は最初のレコードを使用)
    const nameIndex: Record<string, string> = {};
    for (const c of accessibleCustomers) {
      if (!nameIndex[c.name]) nameIndex[c.name] = c.id;
    }

    const stats: Record<string, CustomerBrainStats> = {};
    for (const c of accessibleCustomers as Array<{ id: string; name: string; customer_type: string | null; churn_score: number }>) {
      if (nameIndex[c.name] !== c.id) continue; // 同名重複は最初のみ
      const a = agg[c.id] ?? { visitCount: 0, totalSpent: 0, lastVisitDate: null };
      stats[c.name] = {
        visitCount:    a.visitCount,
        totalSpent:    a.totalSpent,
        lastVisitDate: a.lastVisitDate,
        churnScore:    Number(c.churn_score) ?? 0,
        isVip:         a.totalSpent >= VIP_SPEND,
        customerType:  c.customer_type,
      };
    }

    return NextResponse.json({ stats });
  } catch (e) {
    return NextResponse.json({ stats: {}, error: String(e) });
  }
}

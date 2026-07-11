/**
 * GET /api/proposals/by-name?customerName=xxx
 * Phase1 スタッフ画面向け AI 提案 API。
 * brain_customers を顧客名で検索し、brain_visits 来歴 + ProposalOrchestrator から
 * 実データ提案を生成して返す。
 * 顧客が brain_customers に存在しない場合は found:false を返す（クラッシュしない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../lib/repos';
import { generateCustomerProposal } from '@/lib/proposal/generateCustomerProposal';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';

const STORE_ID    = '00000000-0000-0000-0000-000000000001';
const DEFAULT_STAFF = '00000000-0000-0000-0000-000000000101'; // 鈴木(管理者フォールバック)

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ found: false, reason: 'unauthorized' }, { status: 401 })
  }

  const customerName = req.nextUrl.searchParams.get('customerName');
  if (!customerName) {
    return NextResponse.json({ found: false, reason: 'missing_customerName' });
  }

  try {
    const client = getServiceClient();

    // brain_customers を名前で検索
    const { data: matches } = await client
      .from('brain_customers')
      .select('id, customer_type')
      .eq('store_id', STORE_ID)
      .eq('name', customerName)
      .is('deleted_at', null)
      .limit(1);

    if (!matches || matches.length === 0) {
      return NextResponse.json({ found: false, reason: 'customer_not_found' });
    }

    const bc = matches[0] as { id: string; customer_type: string | null };

    // アクセス権確認
    const accessible = await canAccessCustomer(staff.staffBrainId, bc.id, staff.isAdmin)
    if (!accessible) {
      return NextResponse.json({ found: false, reason: 'forbidden' }, { status: 403 })
    }

    // 直近 3 来院のメニュー（実データ）
    const { data: visits } = await client
      .from('brain_visits')
      .select('menu_name, visit_date, treatment_amount')
      .eq('customer_id', bc.id)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(3);

    const recentMenus: string[] = (visits ?? [])
      .map((v: { menu_name: string | null }) => v.menu_name)
      .filter((m): m is string => !!m);

    // ProposalOrchestrator で提案生成（失敗しても部分データで返す）
    let advice: string | null = null;
    let avoidNote: string | null = null;
    let menuSuggestion: string | null = null;
    let candidateDate: string | null = null;

    try {
      const repos = getRepos();
      // 管理者は DEFAULT_STAFF、スタッフは自身の ID でプロポーザルを生成
      // (非adminはextractStaffFromRequest側でstaffBrainId必須のため、ここではnon-null)
      const staffIdForProposal = staff.isAdmin ? DEFAULT_STAFF : staff.staffBrainId!
      const result = await generateCustomerProposal(
        { storeId: STORE_ID, customerId: bc.id, staffId: staffIdForProposal, legacyClient: client },
        repos
      );

      if (result.ok) {
        const proposal = 'degraded' in result.proposal ? result.proposal.proposal : result.proposal;
        advice         = proposal.explanation.staffLine1 || null;
        avoidNote      = proposal.explanation.staffAvoid || null;
        candidateDate  = proposal.inStore.candidateDate || null;
        menuSuggestion = proposal.inStore.mandatory?.adjustedScript ?? null;
      }
    } catch {
      // ProposalOrchestrator 失敗時は advice=null のまま継続
    }

    return NextResponse.json({
      found:        true,
      customerType: bc.customer_type,
      advice,
      avoidNote,
      menuSuggestion,
      recentMenus,
      candidateDate,
    });
  } catch (e) {
    return NextResponse.json({ found: false, reason: String(e) }, { status: 500 });
  }
}

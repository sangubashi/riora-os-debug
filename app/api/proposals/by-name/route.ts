/**
 * GET /api/proposals/by-name?customerName=xxx | ?customerId=xxx
 * Phase1 スタッフ画面向け AI 提案 API。
 * brain_customers を顧客名(customerName)または顧客ID(customerId)で検索し、
 * brain_visits 来歴 + ProposalOrchestrator から実データ提案を生成して返す。
 * 顧客が brain_customers に存在しない場合は found:false を返す（クラッシュしない）。
 *
 * STAFF_PROPOSAL_LEARNING_PIPELINE: customerIdは AIProposalCard.tsx(CustomerBottomSheet、
 * customerIdを既に保持している)向けの後方互換拡張。customerNameは既存のAIProposalView.tsx
 * (予約カードがcustomerNameしか持たないため)からの呼び出しをそのまま維持する。
 * 両方指定時はcustomerIdを優先する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../lib/repos';
import { generateCustomerProposal } from '@/lib/proposal/generateCustomerProposal';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';

const STORE_ID    = '00000000-0000-0000-0000-000000000001';

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ found: false, reason: 'unauthorized' }, { status: 401 })
  }

  // AUTH-1: 固定UUIDでの人格代替はしない。管理者はbrain_staff行(staffBrainId)を
  // 持たないため、本エンドポイント(スタッフ本人のAI提案生成)は利用不可として扱う
  // (/api/me/monthly-statsのadmin_not_supportedと同じ方針)。
  if (staff.isAdmin || !staff.staffBrainId) {
    return NextResponse.json({ found: false, reason: 'staff_required' }, { status: 400 })
  }

  const customerId   = req.nextUrl.searchParams.get('customerId');
  const customerName = req.nextUrl.searchParams.get('customerName');
  if (!customerId && !customerName) {
    return NextResponse.json({ found: false, reason: 'missing_customer_identifier' });
  }

  try {
    const client = getServiceClient();

    // brain_customers を customerId(優先) または customerName で検索
    const baseQuery = client
      .from('brain_customers')
      .select('id, customer_type, is_internal_user')
      .eq('store_id', STORE_ID)
      .is('deleted_at', null)
      .limit(1);
    const { data: matches } = customerId
      ? await baseQuery.eq('id', customerId)
      : await baseQuery.eq('name', customerName as string);

    if (!matches || matches.length === 0) {
      return NextResponse.json({ found: false, reason: 'customer_not_found' });
    }

    const bc = matches[0] as { id: string; customer_type: string | null; is_internal_user?: boolean };

    // スタッフアプリのAI提案対象からは内部ユーザー(is_internal_user=true。スタッフ本人の
    // 試用・検証購入等)を完全に除外する(存在しない顧客として扱う)。
    if (bc.is_internal_user) {
      return NextResponse.json({ found: false, reason: 'customer_not_found' });
    }

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
    let nextBookingSuggestion: { rangeText: string; talkExample: string } | null = null;

    try {
      const repos = getRepos();
      // AUTH-1: 上のガードで管理者/staffBrainId無しは弾いているため、ここでは常に本人のID。
      const result = await generateCustomerProposal(
        { storeId: STORE_ID, customerId: bc.id, staffId: staff.staffBrainId, legacyClient: client },
        repos
      );

      if (result.ok) {
        const proposal = 'degraded' in result.proposal ? result.proposal.proposal : result.proposal;
        advice         = proposal.explanation.staffLine1 || null;
        avoidNote      = proposal.explanation.staffAvoid || null;
        candidateDate  = proposal.inStore.candidateDate || null;
        menuSuggestion = proposal.inStore.mandatory?.adjustedScript ?? null;
        nextBookingSuggestion = result.nextBookingSuggestion;
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
      nextBookingSuggestion,
    });
  } catch (e) {
    return NextResponse.json({ found: false, reason: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/proposals/fire
 *
 * STAFF_PROPOSAL_LEARNING_PIPELINE: スタッフ画面(AIProposalCard.tsx、CustomerBottomSheet)に
 * ProposalOrchestrator由来のAI提案が実際に表示されたことをbrain_pattern_fire_logへ記録する。
 * 設計根拠: docs/STAFF_PROPOSAL_LEARNING_PIPELINE_DESIGN.md §5.1.5
 *
 * 認証はGET /api/proposals/by-nameと同一パターン(extractStaffFromRequest + canAccessCustomer)。
 * requireAdminは使わない(管理者はこのエンドポイント対象外、by-nameと同方針)。
 * クライアントの言い分を信用せず、customerIdだけを受け取りサーバー側でproposalを再導出する
 * (GET側の表示結果を経由した改ざんを防ぐ)。
 *
 * 重複抑止(DB変更なしの方針のためUNIQUE制約は追加しない): 直近のfire_logをBriefingRepo.
 * recentByCustomer()で読み取り、同一パターン(patternId+stepNo+proposalKind+scriptStyle)が
 * FIRE_DEDUP_WINDOW_MINUTES分以内に既に記録されていればinsertせず、その既存行のidを返す
 * (冪等な挙動)。BottomSheetの再表示・リロードによる短時間の重複記録を防ぐのが目的で、
 * 日をまたぐ再fireは別の機会として意図的に許容する(recordProposalOutcome.tsの30日マッチング窓
 * とは別軸の短時間ガード)。ほぼ同時に届く多重リクエスト同士の完全な排他(真のレースコンディション)
 * まではこの設計では保証しない(DB側にUNIQUE制約を追加しない制約下での既知の限界。
 * クライアント側のuseRefガード(AIProposalCard.tsx)と合わせた多層防御とする)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../lib/repos';
import { generateCustomerProposal } from '@/lib/proposal/generateCustomerProposal';
import { buildFireLogDecisionRecord } from '@/lib/proposal/buildFireLogDecisionRecord';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';
import { proposalFireSchema } from '../../_schemas/proposal';
import { toValidationErrorResponse } from '../../_schemas/common';

const STORE_ID = '00000000-0000-0000-0000-000000000001';

/**
 * 短時間の重複fire抑止ウィンドウ(分)。稼働中の1回の接客セッション程度の長さを想定した値
 * (BottomSheetの再表示・リロードのflapping対策)。この値を超えて日をまたぐ等した場合の
 * 再fireは、新しい機会として正しく別レコードになるべきなので意図的に許容する。
 */
const FIRE_DEDUP_WINDOW_MINUTES = 60;

/**
 * decision_record(jsonb)の読み取り用型。recordProposalOutcome.ts / BriefingRepo.tsと
 * 同じ緩い型付けパターン(BriefingEntry.decisionRecordの公称型には含まれないフィールドを
 * unsafe castで読む)。
 */
interface FireLogDecisionRecordShape {
  degraded?: boolean;
  patternId?: string | null;
  stepNo?: number | null;
  proposalKind?: string | null;
  scriptStyle?: string | null;
}

export async function POST(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  // AUTH-1: by-nameと同方針。管理者はbrain_staff行(staffBrainId)を持たないため、
  // 本エンドポイント(スタッフ本人のAI提案fire)は利用不可として扱う。
  if (staff.isAdmin || !staff.staffBrainId) {
    return NextResponse.json({ success: false, error: 'staff_required' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = proposalFireSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }
  const { customerId } = parsed.data;

  try {
    const client = getServiceClient();

    const { data: customerRow } = await client
      .from('brain_customers')
      .select('id, is_internal_user')
      .eq('id', customerId)
      .eq('store_id', STORE_ID)
      .is('deleted_at', null)
      .maybeSingle();

    // by-nameと同方針: 内部ユーザー(is_internal_user=true)は存在しない顧客として扱う。
    if (!customerRow || (customerRow as { is_internal_user?: boolean }).is_internal_user) {
      return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 });
    }

    const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin);
    if (!accessible) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    const repos = getRepos();
    // legacyClientは渡さない(voiceMemoContextの取得を省略し、fire専用に必要最小限のクエリに留める。
    // decision_recordの組み立てにvoiceMemoContextは使わないため)。
    const result = await generateCustomerProposal(
      { storeId: STORE_ID, customerId, staffId: staff.staffBrainId },
      repos
    );

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.reason }, { status: 404 });
    }

    const { decisionRecord, explanation } = buildFireLogDecisionRecord(result);
    const dr = decisionRecord as FireLogDecisionRecordShape;

    // 重複抑止チェック(縮退提案はpatternId等を持たないため対象外・常にinsertする)。
    if (!dr.degraded && dr.patternId && dr.stepNo != null && dr.proposalKind && dr.scriptStyle) {
      const recent = await repos.briefingRepo.recentByCustomer(customerId, 5);
      const windowMs = FIRE_DEDUP_WINDOW_MINUTES * 60_000;
      const duplicate = recent.find((entry) => {
        const existing = entry.decisionRecord as unknown as FireLogDecisionRecordShape;
        if (existing.degraded) return false;
        if (existing.patternId !== dr.patternId) return false;
        if (existing.stepNo !== dr.stepNo) return false;
        if (existing.proposalKind !== dr.proposalKind) return false;
        if (existing.scriptStyle !== dr.scriptStyle) return false;
        return Date.now() - new Date(entry.createdAt).getTime() <= windowMs;
      });
      if (duplicate) {
        return NextResponse.json({ success: true, fireLogId: duplicate.id, deduped: true });
      }
    }

    const saved = await repos.briefingRepo.insert({
      storeId: STORE_ID,
      customerId,
      visitId: null,
      decisionRecord,
      explanation,
    });

    return NextResponse.json({ success: true, fireLogId: saved.id, deduped: false });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

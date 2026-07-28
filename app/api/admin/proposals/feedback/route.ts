/**
 * POST /api/admin/proposals/feedback(AI提案学習Phase1・提案パネルの👍👎)
 *
 * CustomerProposalPanel.tsxで「提案を記録する」(brain_pattern_fire_logへのinsert)が
 * 成功した直後に、スタッフが押した👍/👎をbrain_pattern_fire_log.decision_recordへ
 * jsonbとして追記するだけ(新規テーブル/新規カラムなし)。
 * brain_proposal_outcomes(客観データ)には一切触れない。PatternScorer/ProposalEngine
 * への接続も行わない(Phase1は収集のみ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { proposalFeedbackSchema } from '../../../_schemas/proposal';
import { toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = proposalFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  try {
    const repos = getRepos();
    const result = await repos.briefingRepo.attachFeedback(parsed.data.fireLogId, {
      storeId: parsed.data.storeId,
      staffId: parsed.data.staffId,
      feedback: parsed.data.feedback,
    });

    if (!result.attached) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json({ success: false, error: result.reason }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

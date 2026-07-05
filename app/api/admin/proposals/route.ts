/**
 * GET/POST /api/admin/proposals(AI提案本物化・顧客詳細から提案生成)
 *
 * 設計根拠: docs/ai/Riora_Proposal_Generator_Architecture_v2.0.md
 *
 * GET: 提案を生成するだけ(DB書込なし・何度でも安全に呼べる)。
 * POST: 生成した提案をbrain_pattern_fire_logへ保存する(提案結果保存)。
 *
 * LLMは一切使用しない(ProposalOrchestrator配下は全て決定論ルール)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../lib/repos';
import { proposalQuerySchema, proposalSaveSchema } from '../../_schemas/proposal';
import { toValidationErrorResponse } from '../../_schemas/common';
import { generateCustomerProposal } from '@/lib/proposal/generateCustomerProposal';
import { requireAdmin } from '@/lib/auth/requireAdmin';

async function buildResult(storeId: string, customerId: string, staffId: string) {
  const repos = getRepos();
  const legacyClient = getServiceClient();
  return generateCustomerProposal({ storeId, customerId, staffId, legacyClient }, repos);
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = proposalQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    customerId: req.nextUrl.searchParams.get('customerId'),
    staffId: req.nextUrl.searchParams.get('staffId'),
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  try {
    const result = await buildResult(parsed.data.storeId, parsed.data.customerId, parsed.data.staffId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.reason }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = proposalSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  try {
    const result = await buildResult(parsed.data.storeId, parsed.data.customerId, parsed.data.staffId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.reason }, { status: 404 });
    }

    const repos = getRepos();
    const decisionRecord = 'degraded' in result.proposal
      ? { degraded: true, reason: result.proposal.reason, contextSnapshot: result.context }
      : {
          candidates: [],
          resolution: { winner: [result.proposal.inStore.mandatory?.candidateCode].filter((v): v is string => !!v), stage4TiebreakUsed: false },
          contextSnapshot: result.context,
          explainTexts: result.proposal.explanation,
        };
    const explanation = 'degraded' in result.proposal ? `提案生成が縮退しました: ${result.proposal.reason}` : result.proposal.explanation.staffLine1;

    const saved = await repos.briefingRepo.insert({
      storeId: parsed.data.storeId,
      customerId: parsed.data.customerId,
      visitId: null,
      decisionRecord,
      explanation,
    });

    return NextResponse.json({ success: true, ...result, saved });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

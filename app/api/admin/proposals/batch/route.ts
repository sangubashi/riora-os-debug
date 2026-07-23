/**
 * POST /api/admin/proposals/batch
 *
 * storeId の全 brain_customers に対して ProposalOrchestrator を実行し
 * brain_pattern_fire_log へ保存する。LLM 不使用・決定論ルールのみ。
 *
 * Body: { storeId: string, staffId: string }
 * Response: { total, succeeded, failed, results[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepos, getServiceClient } from '../../../../lib/repos';
import { generateCustomerProposal } from '@/lib/proposal/generateCustomerProposal';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const batchSchema = z.object({
  storeId: z.string().min(1),
  staffId: z.string().min(1),
});

const CHUNK = 5;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const { storeId, staffId } = parsed.data;
  const repos = getRepos();
  const legacyClient = getServiceClient();

  const customers = await repos.customerRepo.listByStore(storeId);
  const total = customers.length;

  const results: { id: string; name: string; status: string; detail?: string }[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < customers.length; i += CHUNK) {
    const chunk = customers.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (c) => {
        try {
          const result = await generateCustomerProposal(
            { storeId, customerId: c.id, staffId, legacyClient },
            repos,
          );

          if (!result.ok) {
            failed++;
            results.push({ id: c.id, name: c.name, status: 'skip', detail: result.reason });
            return;
          }

          // PHASE 1-Ba: candidateCode文字列のみでは後続のoutcome学習(pattern_id/step_no
          // 単位の集計)に不十分なため、FiredProposalが既に持つ構造化フィールドを
          // decision_recordへ素通しで追加保存する(既存フィールドは変更しない・後方互換)。
          const mandatory = 'degraded' in result.proposal ? null : result.proposal.inStore.mandatory;
          const decisionRecord =
            'degraded' in result.proposal
              ? { degraded: true, reason: result.proposal.reason, contextSnapshot: result.context }
              : {
                  candidates: [],
                  resolution: {
                    winner: [result.proposal.inStore.mandatory?.candidateCode].filter(
                      (v): v is string => !!v,
                    ),
                    stage4TiebreakUsed: false,
                  },
                  contextSnapshot: result.context,
                  explainTexts: result.proposal.explanation,
                  patternId: mandatory?.patternId ?? null,
                  stepNo: mandatory?.stepNo ?? null,
                  proposalKind: mandatory?.proposalKind ?? null,
                  scriptStyle: mandatory?.scriptStyle ?? null,
                };

          const explanation =
            'degraded' in result.proposal
              ? `提案生成が縮退しました: ${result.proposal.reason}`
              : result.proposal.explanation.staffLine1;

          await repos.briefingRepo.insert({
            storeId,
            customerId: c.id,
            visitId: null,
            decisionRecord,
            explanation,
          });

          succeeded++;
          const label =
            'degraded' in result.proposal ? `degraded:${result.proposal.reason}` : 'ok';
          results.push({ id: c.id, name: c.name, status: label });
        } catch (e) {
          failed++;
          results.push({ id: c.id, name: c.name, status: 'error', detail: String(e) });
        }
      }),
    );
    // Supabase 負荷軽減
    if (i + CHUNK < customers.length) await sleep(100);
  }

  return NextResponse.json({ success: true, total, succeeded, failed, results });
}

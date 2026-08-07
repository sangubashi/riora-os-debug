/**
 * buildFireLogDecisionRecord.ts — brain_pattern_fire_log.decision_record組み立ての共通化
 *
 * 元は app/api/admin/proposals/route.ts の POST に実装されていたロジック(PHASE 1-Ba)。
 * app/api/proposals/fire/route.ts(スタッフ向けfire、STAFF_PROPOSAL_LEARNING_PIPELINE)からも
 * 同一構造で使うため関数として切り出す。admin側の出力(挙動)は変更しない純粋なリファクタ。
 */
import type { GenerateCustomerProposalResult } from './generateCustomerProposal';

export interface FireLogDecisionRecordResult {
  decisionRecord: Record<string, unknown>;
  explanation: string;
}

export function buildFireLogDecisionRecord(
  result: Extract<GenerateCustomerProposalResult, { ok: true }>
): FireLogDecisionRecordResult {
  const mandatory = 'degraded' in result.proposal ? null : result.proposal.inStore.mandatory;
  const decisionRecord = 'degraded' in result.proposal
    ? { degraded: true, reason: result.proposal.reason, contextSnapshot: result.context }
    : {
        candidates: [],
        resolution: { winner: [result.proposal.inStore.mandatory?.candidateCode].filter((v): v is string => !!v), stage4TiebreakUsed: false },
        contextSnapshot: result.context,
        explainTexts: result.proposal.explanation,
        patternId: mandatory?.patternId ?? null,
        stepNo: mandatory?.stepNo ?? null,
        proposalKind: mandatory?.proposalKind ?? null,
        scriptStyle: mandatory?.scriptStyle ?? null,
      };
  const explanation = 'degraded' in result.proposal
    ? `提案生成が縮退しました: ${result.proposal.reason}`
    : result.proposal.explanation.staffLine1;

  return { decisionRecord, explanation };
}

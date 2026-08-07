import { describe, expect, it } from 'vitest';
import { buildFireLogDecisionRecord } from '../../../src/lib/proposal/buildFireLogDecisionRecord';
import type { GenerateCustomerProposalResult } from '../../../src/lib/proposal/generateCustomerProposal';
import type { FinalProposalSet, PatternContext } from '../../../src/types/riora.types';

const CTX: PatternContext = {
  visitCount: 2, daysSinceLast: 10, avgCycle: 30, isNominationStreak2: false, homecarePurchasedEver: false,
  homecareDeclinedRecent: false, skinImproved: false, skinStagnant2: false, subscConditionsMet: 0, churnScore: 0,
  nextBookingMadeLast: false, weddingDaysLeft: null, retailTotal: 0,
  raw: { typeConfidence: 0.8, csi: 0.5, skinDeltaTrend: 0, cycleRatio: 1, lastVisitDate: '2026-06-01' },
  customerType: 'B_pore', customerId: 'c1', storeId: 'store-1',
};

const PROPOSAL: FinalProposalSet = {
  inStore: { mandatory: { customerId: 'c1', candidateCode: 'B1-step1', patternId: 'B1', stepNo: 1, proposalKind: 'none', baseScript: 'x', adjustedScript: 'x', scriptStyle: 'evidence', priority: 1, isMandatory: true, fireScore: 80, decisiveFactor: 'タイミングの良さ(寄与10.0点)' }, secondary: null, candidateDate: null },
  dm: null,
  explanation: { staffLine1: 'B1-step1を提案します。', staffAvoid: null, managerQ1: 'x', managerQ2: 'y', managerQ3: 'z' },
  decisionRecordId: null,
};

const NORMAL_RESULT: Extract<GenerateCustomerProposalResult, { ok: true }> = {
  ok: true, proposal: PROPOSAL, context: CTX,
  voiceMemoContext: { linkStatus: 'no_match', legacyCustomerId: null, customerNotes: [], contraindications: [], latestBookingPromptSummary: null, latestHandoverSummary: null },
  lineHistoryContext: { recentCount: 0, items: [] },
  nextBookingSuggestion: null,
  menuAIContext: null,
};

const DEGRADED_RESULT: Extract<GenerateCustomerProposalResult, { ok: true }> = {
  ...NORMAL_RESULT,
  proposal: { degraded: true, reason: 'no_active_pattern', proposal: PROPOSAL },
};

describe('buildFireLogDecisionRecord', () => {
  it('通常提案の場合、patternId/stepNo/proposalKind/scriptStyleを含むdecisionRecordを返す', () => {
    const { decisionRecord, explanation } = buildFireLogDecisionRecord(NORMAL_RESULT);

    expect(decisionRecord).toMatchObject({
      patternId: 'B1', stepNo: 1, proposalKind: 'none', scriptStyle: 'evidence',
      contextSnapshot: CTX,
      explainTexts: PROPOSAL.explanation,
    });
    expect((decisionRecord as { resolution: { winner: string[] } }).resolution.winner).toEqual(['B1-step1']);
    expect(explanation).toBe('B1-step1を提案します。');
  });

  it('縮退提案の場合、degraded:trueとreason/contextSnapshotのみのdecisionRecordを返す', () => {
    const { decisionRecord, explanation } = buildFireLogDecisionRecord(DEGRADED_RESULT);

    expect(decisionRecord).toEqual({ degraded: true, reason: 'no_active_pattern', contextSnapshot: CTX });
    expect(explanation).toBe('提案生成が縮退しました: no_active_pattern');
  });
});

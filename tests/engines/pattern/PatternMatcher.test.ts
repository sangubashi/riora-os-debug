// ================================================================
// Riora Brain Phase2 - Step5: PatternMatcher 検証
//
// Pattern Engine Code Architecture v1.0 §12 必須観点:
// Gate順序(G-SUB→G-CHURN→G-COOL)とblockedBy正確性/testing 50%の決定論(hash)/lifecycle除外
// ================================================================

import { describe, expect, it } from 'vitest';
import { JsonLogicEvaluator } from '../../../src/engines/pattern/JsonLogicEvaluator';
import { isInTestingGroup, PatternMatcher } from '../../../src/engines/pattern/PatternMatcher';
import type { Candidate, MatchInput, OutcomeLite, PatternContext } from '../../../src/types/riora.types';

function buildCtx(overrides: Partial<PatternContext> = {}): PatternContext {
  return {
    visitCount: 4,
    daysSinceLast: 30,
    avgCycle: 30,
    isNominationStreak2: false,
    homecarePurchasedEver: false,
    homecareDeclinedRecent: false,
    skinImproved: false,
    skinStagnant2: false,
    subscConditionsMet: 4,
    churnScore: 0.1,
    nextBookingMadeLast: true,
    weddingDaysLeft: null,
    retailTotal: 0,
    raw: {
      typeConfidence: 0.8,
      csi: 0.5,
      skinDeltaTrend: 0,
      cycleRatio: 1,
      lastVisitDate: '2026-05-13',
    },
    customerType: 'B_pore',
    customerId: 'customer-1',
    storeId: 'store-1',
    ...overrides,
  };
}

function buildCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    uid: 'cand-1',
    code: 'B1-step1',
    channel: 'in_store',
    patternCode: 'B1',
    stepNo: 1,
    customerType: null,
    proposalKind: 'homecare',
    isSales: true,
    priorityClass: 3,
    hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} },
    baseScript: 'ホームケアのご提案です',
    cooldownVisits: 2,
    lifecycleStatus: 'active',
    version: 1,
    ...overrides,
  };
}

function buildInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    candidates: [],
    ctx: buildCtx(),
    recentOutcomes: [],
    consentDm: true,
    nowJst: '2026-06-12T10:00:00+09:00',
    ...overrides,
  };
}

describe('PatternMatcher', () => {
  describe('Stage 0: lifecycleフィルタ', () => {
    it('active/testing以外のlifecycle_statusは "lifecycle" でstageReached=0として除外する', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      for (const lifecycleStatus of ['candidate', 'watch', 'demoted', 'suspended'] as const) {
        const candidate = buildCandidate({ lifecycleStatus, proposalKind: 'rebooking', isSales: false });
        const result = matcher.match(buildInput({ candidates: [candidate] }));

        expect(result.eligible).toEqual([]);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0]).toMatchObject({ stageReached: 0, blockedBy: 'lifecycle' });
      }
    });

    it('lifecycle_status="active"はtesting判定をスキップしeligibleになる', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ lifecycleStatus: 'active', proposalKind: 'rebooking', isSales: false });
      const result = matcher.match(buildInput({ candidates: [candidate] }));

      expect(result.rejected).toEqual([]);
      expect(result.eligible).toEqual([candidate]);
    });
  });

  describe('Stage 0: testing 50%適用の決定論(hash)', () => {
    it('同一(customerId, code)は常に同じtestグループ判定になる(乱数禁止)', () => {
      const a = isInTestingGroup('customer-42', 'B1-step1');
      const b = isInTestingGroup('customer-42', 'B1-step1');
      expect(a).toBe(b);
    });

    it('test群の顧客はtesting候補がeligibleになり、control群の顧客はlifecycleで除外される', () => {
      const code = 'B1-step1';
      let testGroupCustomer = '';
      let controlGroupCustomer = '';
      for (let i = 0; i < 200 && (!testGroupCustomer || !controlGroupCustomer); i++) {
        const customerId = `customer-${i}`;
        if (isInTestingGroup(customerId, code)) {
          testGroupCustomer ||= customerId;
        } else {
          controlGroupCustomer ||= customerId;
        }
      }
      expect(testGroupCustomer).not.toBe('');
      expect(controlGroupCustomer).not.toBe('');

      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({
        code,
        lifecycleStatus: 'testing',
        proposalKind: 'rebooking',
        isSales: false,
      });

      const testResult = matcher.match(
        buildInput({ candidates: [candidate], ctx: buildCtx({ customerId: testGroupCustomer }) })
      );
      expect(testResult.eligible).toEqual([candidate]);
      expect(testResult.rejected).toEqual([]);

      const controlResult = matcher.match(
        buildInput({ candidates: [candidate], ctx: buildCtx({ customerId: controlGroupCustomer }) })
      );
      expect(controlResult.eligible).toEqual([]);
      expect(controlResult.rejected[0]).toMatchObject({ stageReached: 0, blockedBy: 'lifecycle' });
      expect(controlResult.rejected[0].detail).toContain('control group');
    });
  });

  describe('Stage 1: Hard gates', () => {
    it('G-SUB: subscription候補はsubsc_conditions_met<4で除外される', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'subscription', isSales: true });

      const blocked = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ subscConditionsMet: 3 }) }));
      expect(blocked.eligible).toEqual([]);
      expect(blocked.rejected[0]).toMatchObject({ stageReached: 1, blockedBy: 'G-SUB' });

      const passed = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ subscConditionsMet: 4 }) }));
      expect(passed.eligible).toEqual([candidate]);
      expect(passed.rejected).toEqual([]);
    });

    it('G-CHURN(O3): churn_score>0.7の販売系候補は除外され、非販売系は通過する', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const ctx = buildCtx({ churnScore: 0.8, subscConditionsMet: 4 });

      const salesCandidate = buildCandidate({ proposalKind: 'homecare', isSales: true });
      const salesResult = matcher.match(buildInput({ candidates: [salesCandidate], ctx }));
      expect(salesResult.eligible).toEqual([]);
      expect(salesResult.rejected[0]).toMatchObject({ stageReached: 1, blockedBy: 'G-CHURN' });

      const nonSalesCandidate = buildCandidate({ code: 'B1-step2', proposalKind: 'rebooking', isSales: false });
      const nonSalesResult = matcher.match(buildInput({ candidates: [nonSalesCandidate], ctx }));
      expect(nonSalesResult.eligible).toEqual([nonSalesCandidate]);
      expect(nonSalesResult.rejected).toEqual([]);
    });

    it('G-COOL: 直近2来店以内に同種proposal_kindが拒否されていれば除外する(<=境界)', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'homecare', isSales: true, cooldownVisits: 2 });
      const declinedAtVisit2: OutcomeLite = {
        patternId: 'B1',
        stepNo: 1,
        proposalKind: 'homecare',
        visitCountAt: 2,
        wasExecuted: true,
        wasAccepted: false,
        occurredAt: '2026-04-01T00:00:00+09:00',
      };

      // visit 4: 4-2=2 <= cooldown(2) → 禁止
      const blocked = matcher.match(
        buildInput({ candidates: [candidate], ctx: buildCtx({ visitCount: 4, churnScore: 0.1 }), recentOutcomes: [declinedAtVisit2] })
      );
      expect(blocked.eligible).toEqual([]);
      expect(blocked.rejected[0]).toMatchObject({ stageReached: 1, blockedBy: 'G-COOL' });

      // visit 5: 5-2=3 > cooldown(2) → 解禁
      const allowed = matcher.match(
        buildInput({ candidates: [candidate], ctx: buildCtx({ visitCount: 5, churnScore: 0.1 }), recentOutcomes: [declinedAtVisit2] })
      );
      expect(allowed.eligible).toEqual([candidate]);
      expect(allowed.rejected).toEqual([]);
    });

    it('受諾済み(wasAccepted=true)の履歴はG-COOLの対象にならない', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'homecare', isSales: true, cooldownVisits: 2 });
      const acceptedAtVisit2: OutcomeLite = {
        patternId: 'B1',
        stepNo: 1,
        proposalKind: 'homecare',
        visitCountAt: 2,
        wasExecuted: true,
        wasAccepted: true,
        occurredAt: '2026-04-01T00:00:00+09:00',
      };

      const result = matcher.match(
        buildInput({ candidates: [candidate], ctx: buildCtx({ visitCount: 4, churnScore: 0.1 }), recentOutcomes: [acceptedAtVisit2] })
      );
      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });

    it('G-CONSENT: channel=dmでconsentDm=falseの場合は除外する', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ channel: 'dm', proposalKind: 'rebooking', isSales: false });

      const result = matcher.match(buildInput({ candidates: [candidate], consentDm: false }));
      expect(result.eligible).toEqual([]);
      expect(result.rejected[0]).toMatchObject({ stageReached: 1, blockedBy: 'G-CONSENT' });
    });

    it('Gate順序: G-SUBとG-CHURNを同時に満たす候補はG-SUBが先に検出される', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'subscription', isSales: true });
      const ctx = buildCtx({ subscConditionsMet: 2, churnScore: 0.9 });

      const result = matcher.match(buildInput({ candidates: [candidate], ctx }));
      expect(result.rejected[0]).toMatchObject({ stageReached: 1, blockedBy: 'G-SUB' });
    });
  });

  describe('Stage 1: Hard condition', () => {
    it('fire_conditionが満たされない候補は "condition" でstageReached=1として除外する', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({
        proposalKind: 'rebooking',
        isSales: false,
        hardCondition: { '==': [{ var: 'visit_count' }, 99] },
      });

      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ visitCount: 4 }) }));
      expect(result.eligible).toEqual([]);
      expect(result.rejected[0]).toMatchObject({ stageReached: 1, blockedBy: 'condition' });
    });

    it('fire_conditionが満たされる候補はeligibleになる', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({
        proposalKind: 'rebooking',
        isSales: false,
        hardCondition: { '==': [{ var: 'visit_count' }, 4] },
      });

      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ visitCount: 4 }) }));
      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('複数候補の混在', () => {
    it('eligible/rejectedを候補ごとに正しく振り分ける', () => {
      const matcher = new PatternMatcher(new JsonLogicEvaluator());
      const okCandidate = buildCandidate({
        code: 'B1-step1',
        proposalKind: 'rebooking',
        isSales: false,
        hardCondition: { '==': [{ var: 'visit_count' }, 4] },
      });
      const subCandidate = buildCandidate({
        code: 'B1-step2',
        uid: 'cand-2',
        proposalKind: 'subscription',
        isSales: true,
      });
      const suspendedCandidate = buildCandidate({
        code: 'B1-step3',
        uid: 'cand-3',
        lifecycleStatus: 'suspended',
      });

      const result = matcher.match(
        buildInput({
          candidates: [okCandidate, subCandidate, suspendedCandidate],
          ctx: buildCtx({ visitCount: 4, subscConditionsMet: 2 }),
        })
      );

      expect(result.eligible).toEqual([okCandidate]);
      expect(result.rejected).toHaveLength(2);
      expect(result.rejected.find((r) => r.candidate.uid === 'cand-2')).toMatchObject({ blockedBy: 'G-SUB' });
      expect(result.rejected.find((r) => r.candidate.uid === 'cand-3')).toMatchObject({ blockedBy: 'lifecycle' });
    });
  });
});

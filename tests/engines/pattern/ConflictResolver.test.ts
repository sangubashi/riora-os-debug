// ================================================================
// Riora Brain Phase2 - Step7: ConflictResolver 検証
//
// Pattern Engine Code Architecture v1.0 §12 必須観点:
// 排他行列全セル/販売1件繰上げ/タイブレーク④まで/不変条件throw/
// ヒステリシス(streak=1不切替・2切替・stalled即)
// ================================================================

import { describe, expect, it } from 'vitest';
import { ConflictResolver } from '../../../src/engines/pattern/ConflictResolver';
import { JsonLogicEvaluator } from '../../../src/engines/pattern/JsonLogicEvaluator';
import { EngineInvariantError } from '../../../src/types/riora.types';
import type {
  AffinityResolved,
  Candidate,
  CellKey,
  CellStats,
  Overrides,
  PatternContext,
  PatternProgress,
  ScoreBreakdown,
  ScoredCandidate,
  SuccessPattern,
} from '../../../src/types/riora.types';

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
    proposalKind: 'rebooking',
    isSales: false,
    priorityClass: 2,
    hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} },
    baseScript: '',
    cooldownVisits: 2,
    lifecycleStatus: 'active',
    version: 1,
    ...overrides,
  };
}

const DEFAULT_BREAKDOWN: ScoreBreakdown = {
  successRate: 0,
  contextFit: 0,
  timing: 0,
  affinity: 0,
  urgency: 0,
  overrideBoost: 1,
  churnPenalty: 1,
};

function buildScored(fireScore: number, candidateOverrides: Partial<Candidate> = {}): ScoredCandidate {
  return {
    candidate: buildCandidate(candidateOverrides),
    features: {
      timing_proximity: 1,
      cycle_position: 1,
      condition_margin: 1,
      type_confidence: 1,
      csi_alignment: 1,
      skin_momentum: 1,
    },
    breakdown: { ...DEFAULT_BREAKDOWN },
    fireScore,
  };
}

function buildAffinity(overrides: Partial<AffinityResolved> = {}): AffinityResolved {
  return {
    style: 'evidence',
    perKind: new Map(),
    timingOffsets: new Map(),
    constraints: { mandatoryMax: 1 },
    ...overrides,
  };
}

function buildOverrides(overrides: Partial<Overrides> = {}): Overrides {
  return { manualPin: null, storeOverrideCodes: new Set(), ...overrides };
}

describe('ConflictResolver', () => {
  describe('Stage3: 店内枠詰め(G-FREQ精密化)', () => {
    it('販売系2件+非販売1件 -> mandatoryは最高スコア販売、secondaryは非販売、2件目販売はslotで除外', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const sales1 = buildScored(80, { uid: 'sales-1', code: 'B1-sales1', proposalKind: 'homecare', isSales: true });
      const sales2 = buildScored(70, { uid: 'sales-2', code: 'B1-sales2', proposalKind: 'upsell', isSales: true });
      const nonSales = buildScored(60, { uid: 'rebook-1', code: 'B1-rebook', proposalKind: 'rebooking', isSales: false });

      const result = resolver.resolve(
        [sales1, sales2, nonSales],
        buildCtx(),
        new Map(),
        buildAffinity(),
        buildOverrides()
      );

      expect(result.inStore.mandatory?.candidate.uid).toBe('sales-1');
      expect(result.inStore.secondary?.candidate.uid).toBe('rebook-1');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]).toMatchObject({ candidate: { uid: 'sales-2' }, stageReached: 3, blockedBy: 'slot' });
    });

    it('非販売がmandatoryになった場合、2位の販売系はscoreでslotから除外される', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const nonSales = buildScored(90, { uid: 'rebook-1', code: 'B1-rebook', proposalKind: 'rebooking', isSales: false });
      const sales1 = buildScored(80, { uid: 'sales-1', code: 'B1-sales1', proposalKind: 'homecare', isSales: true });

      const result = resolver.resolve([nonSales, sales1], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.inStore.mandatory?.candidate.uid).toBe('rebook-1');
      expect(result.inStore.secondary).toBeNull();
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]).toMatchObject({ candidate: { uid: 'sales-1' }, stageReached: 3, blockedBy: 'score' });
    });

    it('非販売が3件ある場合、secondaryは上位1件のみでそれ以外はslotで除外される', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const c1 = buildScored(90, { uid: 'c1', code: 'B1-c1', proposalKind: 'rebooking', isSales: false });
      const c2 = buildScored(80, { uid: 'c2', code: 'B1-c2', proposalKind: 'homecare', isSales: false });
      const c3 = buildScored(70, { uid: 'c3', code: 'B1-c3', proposalKind: 'none', isSales: false });

      const result = resolver.resolve([c1, c2, c3], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.inStore.mandatory?.candidate.uid).toBe('c1');
      expect(result.inStore.secondary?.candidate.uid).toBe('c2');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]).toMatchObject({ candidate: { uid: 'c3' }, stageReached: 3, blockedBy: 'slot' });
    });
  });

  describe('Stage0/Stage2: DM排他(同種proposal_kindの店内優先)', () => {
    it('dm候補が店内勝者と同じproposal_kindならexclusionで除外される', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const inStoreWinner = buildScored(90, { uid: 'in-1', code: 'B1-in1', channel: 'in_store', proposalKind: 'homecare', isSales: true });
      const dmSameKind = buildScored(70, { uid: 'dm-1', code: 'S-DM1', channel: 'dm', proposalKind: 'homecare', isSales: true });
      const dmDifferentKind = buildScored(60, { uid: 'dm-2', code: 'S-DM2', channel: 'dm', proposalKind: 'rebooking', isSales: false });

      const result = resolver.resolve(
        [inStoreWinner, dmSameKind, dmDifferentKind],
        buildCtx(),
        new Map(),
        buildAffinity(),
        buildOverrides()
      );

      expect(result.dm?.candidate.uid).toBe('dm-2');
      const excluded = result.rejected.find((r) => r.candidate.uid === 'dm-1');
      expect(excluded).toMatchObject({ stageReached: 2, blockedBy: 'exclusion', detail: 'superseded_by_instore' });
    });

    it('dm候補が複数残る場合、slots.dmを超えた分はslotで除外される', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const dm1 = buildScored(80, { uid: 'dm-1', code: 'S-DM1', channel: 'dm', proposalKind: 'rebooking', isSales: false });
      const dm2 = buildScored(70, { uid: 'dm-2', code: 'S-DM2', channel: 'dm', proposalKind: 'none', isSales: false });

      const result = resolver.resolve([dm1, dm2], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.dm?.candidate.uid).toBe('dm-1');
      expect(result.rejected).toEqual([
        expect.objectContaining({ candidate: expect.objectContaining({ uid: 'dm-2' }), stageReached: 3, blockedBy: 'slot' }),
      ]);
    });
  });

  describe('O2: 店舗オーバーライド(常勝・スコア比較免除)', () => {
    it('storeOverrideCodes対象の候補は、fireScoreが低くてもmandatoryになる', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const high = buildScored(95, { uid: 'high', code: 'B1-high', isSales: false });
      const overridden = buildScored(10, { uid: 'low', code: 'B1-low', isSales: false });

      const result = resolver.resolve(
        [high, overridden],
        buildCtx(),
        new Map(),
        buildAffinity(),
        buildOverrides({ storeOverrideCodes: new Set(['B1-low']) })
      );

      expect(result.inStore.mandatory?.candidate.uid).toBe('low');
      expect(result.inStore.secondary?.candidate.uid).toBe('high');
    });
  });

  describe('Stage4: タイブレーク', () => {
    it('①fireScore同値のときpriorityClassが小さい方(緊急度高い)が勝つ', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const urgent = buildScored(80, { uid: 'urgent', code: 'B1-urgent', priorityClass: 1, isSales: false });
      const relaxed = buildScored(80, { uid: 'relaxed', code: 'B1-relaxed', priorityClass: 3, isSales: false });

      const result = resolver.resolve([relaxed, urgent], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.inStore.mandatory?.candidate.uid).toBe('urgent');
      expect(result.tiebreakUsed).toBe(true);
    });

    it('②priorityClassも同値のとき、cellのexecutedNが大きい方が勝つ', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const ctx = buildCtx();
      const affinity = buildAffinity();
      const a = buildScored(80, { uid: 'a', code: 'B1-a', priorityClass: 2, isSales: false });
      const b = buildScored(80, { uid: 'b', code: 'B1-b', priorityClass: 2, isSales: false });

      const stats = new Map<CellKey, CellStats>([
        [`B1-a:${ctx.customerType}:${affinity.style}`, { executedN: 5, acceptedN: 1, laplaceRate: 0.2, repeatRate90d: null }],
        [`B1-b:${ctx.customerType}:${affinity.style}`, { executedN: 20, acceptedN: 1, laplaceRate: 0.05, repeatRate90d: null }],
      ]);

      const result = resolver.resolve([a, b], ctx, stats, affinity, buildOverrides());

      expect(result.inStore.mandatory?.candidate.uid).toBe('b');
      expect(result.tiebreakUsed).toBe(true);
    });

    it('③executedNも同値のとき、versionが新しい方が勝つ', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const older = buildScored(80, { uid: 'older', code: 'B1-x', priorityClass: 2, isSales: false, version: 1 });
      const newer = buildScored(80, { uid: 'newer', code: 'B1-y', priorityClass: 2, isSales: false, version: 2 });

      const result = resolver.resolve([older, newer], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.inStore.mandatory?.candidate.uid).toBe('newer');
      expect(result.tiebreakUsed).toBe(true);
    });

    it('④versionも同値のとき、codeの辞書順が小さい方が勝つ(完全再現性の最終保証)', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const b = buildScored(80, { uid: 'b', code: 'B1-step2', priorityClass: 2, isSales: false, version: 1 });
      const a = buildScored(80, { uid: 'a', code: 'B1-step1', priorityClass: 2, isSales: false, version: 1 });

      const result = resolver.resolve([b, a], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.inStore.mandatory?.candidate.uid).toBe('a');
      expect(result.tiebreakUsed).toBe(true);
    });

    it('fireScoreに差があればタイブレークに踏み込まない(tiebreakUsed=false)', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const high = buildScored(90, { uid: 'high', code: 'B1-high', isSales: false });
      const low = buildScored(80, { uid: 'low', code: 'B1-low', isSales: false });

      const result = resolver.resolve([high, low], buildCtx(), new Map(), buildAffinity(), buildOverrides());

      expect(result.tiebreakUsed).toBe(false);
    });
  });

  describe('不変条件(EngineInvariantError)', () => {
    it('subscription提案が選出される時にsubsc_conditions_met!=4ならthrowする', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const subsc = buildScored(90, { uid: 'subsc', code: 'B1-subsc', proposalKind: 'subscription', isSales: true });
      const ctx = buildCtx({ subscConditionsMet: 2 });

      expect(() => resolver.resolve([subsc], ctx, new Map(), buildAffinity(), buildOverrides())).toThrow(EngineInvariantError);
    });

    it('churn_score>0.7のときに販売系が選出されるとthrowする', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const sales = buildScored(90, { uid: 'sales', code: 'B1-sales', proposalKind: 'homecare', isSales: true });
      const ctx = buildCtx({ churnScore: 0.8 });

      expect(() => resolver.resolve([sales], ctx, new Map(), buildAffinity(), buildOverrides())).toThrow(EngineInvariantError);
    });
  });

  describe('決定論(同入力で複数回実行しても結果が一致)', () => {
    it('同じscoredを100回resolveしても同じ結果になる', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const a = buildScored(80, { uid: 'a', code: 'B1-a', priorityClass: 2, isSales: false });
      const b = buildScored(80, { uid: 'b', code: 'B1-b', priorityClass: 2, isSales: true });
      const c = buildScored(75, { uid: 'c', code: 'B1-c', channel: 'dm', priorityClass: 1, isSales: false, proposalKind: 'none' });

      const results = Array.from({ length: 100 }, () =>
        resolver.resolve([a, b, c], buildCtx(), new Map(), buildAffinity(), buildOverrides())
      );

      const first = results[0];
      for (const r of results) {
        expect(r.inStore.mandatory?.candidate.uid).toBe(first.inStore.mandatory?.candidate.uid);
        expect(r.inStore.secondary?.candidate.uid).toBe(first.inStore.secondary?.candidate.uid);
        expect(r.dm?.candidate.uid).toBe(first.dm?.candidate.uid);
      }
    });
  });

  describe('resolveAssignment: パターン割当ヒステリシス(Final v1.0 2-3 ケース1)', () => {
    function buildPattern(overrides: Partial<SuccessPattern> = {}): SuccessPattern {
      return {
        id: 'pattern-a1',
        storeId: 'store-1',
        customerType: 'A_acne',
        label: 'A1',
        entryCondition: { and: [{ '==': [{ var: 'skin_improved' }, false] }, { '>=': [{ var: 'visit_count' }, 1] }] },
        targetCycleDays: 28,
        version: 1,
        isActive: true,
        origin: 'manual',
        lifecycleStatus: 'active',
        lifecycleChangedAt: null,
        ...overrides,
      };
    }

    function buildProgress(overrides: Partial<PatternProgress> = {}): PatternProgress {
      return {
        customerId: 'customer-1',
        patternId: 'pattern-a1',
        patternVersion: 1,
        currentStep: 1,
        enteredAt: '2026-05-01T00:00:00+09:00',
        stepAdvancedAt: null,
        stalledFlag: false,
        completed: false,
        abandonedReason: null,
        assignScore: null,
        switchCandidate: null,
        switchStreak: 0,
        ...overrides,
      };
    }

    it('初回割当(progress=null): entry_condition全充足のパターンからAssignScore最大を採用する(A>C>B>D)', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const a1 = buildPattern({ id: 'pattern-a1', customerType: 'A_acne' });
      const c1 = buildPattern({ id: 'pattern-c1', customerType: 'C_sensitive', label: 'C1' });
      const ctx = buildCtx({ customerType: 'A_acne', raw: { ...buildCtx().raw, typeConfidence: 0.8 } });

      const decision = resolver.resolveAssignment([a1, c1], ctx, null);

      expect(decision.patternId).toBe('pattern-a1');
      expect(decision.switched).toBe(false);
      expect(decision.abandonedPatternId).toBeNull();
    });

    it('streak=1: 新パターンが+0.15を超えて優勢でも1回目は切替せず、switchCandidateを記録する', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      // A1は一部条件が崩れてmargin=0.5(=条件2件中1件のみ充足) -> score=0.5*0.8*4=1.6
      const a1 = buildPattern({
        id: 'pattern-a1',
        customerType: 'A_acne',
        entryCondition: { and: [{ '==': [{ var: 'skin_improved' }, true] }, { '>=': [{ var: 'visit_count' }, 1] }] },
      });
      // C1はentry_condition全充足(margin=1) -> score=1*0.8*3=2.4 (2.4 > 1.6+0.15)
      const c1 = buildPattern({
        id: 'pattern-c1',
        customerType: 'C_sensitive',
        label: 'C1',
        entryCondition: { '>=': [{ var: 'visit_count' }, 1] },
      });
      const ctx = buildCtx({ customerType: 'A_acne', raw: { ...buildCtx().raw, typeConfidence: 0.8 } });
      const progress = buildProgress({ patternId: 'pattern-a1', switchCandidate: null, switchStreak: 0 });

      const decision = resolver.resolveAssignment([a1, c1], ctx, progress);

      expect(decision.switched).toBe(false);
      expect(decision.patternId).toBe('pattern-a1');
      expect(decision.switchCandidate).toBe('pattern-c1');
      expect(decision.switchStreak).toBe(1);
    });

    it('streak=2: 同じ切替候補が2回連続で優勢なら切替し、abandonedPatternIdを記録する', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const a1 = buildPattern({
        id: 'pattern-a1',
        customerType: 'A_acne',
        entryCondition: { and: [{ '==': [{ var: 'skin_improved' }, true] }, { '>=': [{ var: 'visit_count' }, 1] }] },
      });
      const c1 = buildPattern({
        id: 'pattern-c1',
        customerType: 'C_sensitive',
        label: 'C1',
        entryCondition: { '>=': [{ var: 'visit_count' }, 1] },
      });
      const ctx = buildCtx({ customerType: 'A_acne', raw: { ...buildCtx().raw, typeConfidence: 0.8 } });
      const progress = buildProgress({ patternId: 'pattern-a1', switchCandidate: 'pattern-c1', switchStreak: 1 });

      const decision = resolver.resolveAssignment([a1, c1], ctx, progress);

      expect(decision.switched).toBe(true);
      expect(decision.patternId).toBe('pattern-c1');
      expect(decision.abandonedPatternId).toBe('pattern-a1');
      expect(decision.switchCandidate).toBeNull();
      expect(decision.switchStreak).toBe(0);
    });

    it('stalled_flag=trueなら1回目でも即切替する', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const a1 = buildPattern({
        id: 'pattern-a1',
        customerType: 'A_acne',
        entryCondition: { and: [{ '==': [{ var: 'skin_improved' }, true] }, { '>=': [{ var: 'visit_count' }, 1] }] },
      });
      const c1 = buildPattern({
        id: 'pattern-c1',
        customerType: 'C_sensitive',
        label: 'C1',
        entryCondition: { '>=': [{ var: 'visit_count' }, 1] },
      });
      const ctx = buildCtx({ customerType: 'A_acne', raw: { ...buildCtx().raw, typeConfidence: 0.8 } });
      const progress = buildProgress({ patternId: 'pattern-a1', stalledFlag: true, switchCandidate: null, switchStreak: 0 });

      const decision = resolver.resolveAssignment([a1, c1], ctx, progress);

      expect(decision.switched).toBe(true);
      expect(decision.patternId).toBe('pattern-c1');
      expect(decision.abandonedPatternId).toBe('pattern-a1');
    });

    it('新パターンの優勢が閾値+0.15を超えない場合は切替候補をリセットする', () => {
      const resolver = new ConflictResolver(new JsonLogicEvaluator());
      const a1 = buildPattern({ id: 'pattern-a1', customerType: 'A_acne' });
      const c1 = buildPattern({ id: 'pattern-c1', customerType: 'C_sensitive', label: 'C1' });
      const ctx = buildCtx({ customerType: 'A_acne', raw: { ...buildCtx().raw, typeConfidence: 0.8 } });
      // 両方entry_condition全充足(margin=1): a1=1*0.8*4=3.2, c1=1*0.8*3=2.4 -> c1はa1+0.15を超えない
      const progress = buildProgress({ patternId: 'pattern-a1', switchCandidate: 'pattern-c1', switchStreak: 1 });

      const decision = resolver.resolveAssignment([a1, c1], ctx, progress);

      expect(decision.switched).toBe(false);
      expect(decision.patternId).toBe('pattern-a1');
      expect(decision.switchCandidate).toBeNull();
      expect(decision.switchStreak).toBe(0);
    });
  });
});

// ================================================================
// Riora Brain Phase2 - Step6: PatternScorer 検証
//
// Pattern Engine Code Architecture v1.0 §12 必須観点:
// 5項の数値一致(手計算フィクスチャ)/prior 0.5/churnペナルティ境界(0.5, 0.7)/O1×1.5/重み注入
// ================================================================

import { describe, expect, it } from 'vitest';
import { PatternScorer } from '../../../src/engines/pattern/PatternScorer';
import type { AffinityResolved, Candidate, CellKey, CellStats, Overrides, PatternContext, ScoringWeights } from '../../../src/types/riora.types';

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
      csi: 0.6,
      skinDeltaTrend: 0.4,
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
    proposalKind: 'rebooking',
    isSales: false,
    priorityClass: 2,
    hardCondition: { '==': [1, 1] },
    softFeatures: {
      weights: { cycle_position: 1, condition_margin: 1, type_confidence: 1, csi_alignment: 1, skin_momentum: 1 },
      optimalVisit: 4,
    },
    baseScript: 'リバウンド予防のためのご来店をご案内します',
    cooldownVisits: 2,
    lifecycleStatus: 'active',
    version: 1,
    ...overrides,
  };
}

function buildWeights(overrides: Partial<ScoringWeights> = {}): ScoringWeights {
  return { w1: 0.3, w2: 0.2, w3: 0.2, w4: 0.15, w5: 0.15, ...overrides };
}

function buildAffinity(overrides: Partial<AffinityResolved> = {}): AffinityResolved {
  return {
    style: 'evidence',
    perKind: new Map([['rebooking', 0.6]]),
    timingOffsets: new Map(),
    constraints: { mandatoryMax: 1 },
    ...overrides,
  };
}

function buildOverrides(overrides: Partial<Overrides> = {}): Overrides {
  return { manualPin: null, storeOverrideCodes: new Set(), ...overrides };
}

describe('PatternScorer', () => {
  it('FireScoreの5項とbreakdownが手計算フィクスチャと一致する', () => {
    const scorer = new PatternScorer();
    const candidate = buildCandidate();
    const ctx = buildCtx();
    const weights = buildWeights();

    const [result] = scorer.score([candidate], ctx, new Map(), weights, buildAffinity(), buildOverrides());

    // features: visitCount===optimalVisit(=4) -> timing=exp(0)=1, cycleRatio===ideal(1) -> cycle_position=1
    expect(result.features.timing_proximity).toBeCloseTo(1, 6);
    expect(result.features.cycle_position).toBeCloseTo(1, 6);
    // !isSales -> condition_margin = clamp01(1 - churnScore/0.7) = 1 - 0.1/0.7
    expect(result.features.condition_margin).toBeCloseTo(1 - 0.1 / 0.7, 6);
    expect(result.features.type_confidence).toBeCloseTo(0.8, 6);
    expect(result.features.csi_alignment).toBeCloseTo(0.6, 6);
    expect(result.features.skin_momentum).toBeCloseTo(0.4, 6);

    // contextFit = avg(cycle_position, condition_margin, type_confidence, csi_alignment, skin_momentum)
    const contextFit = (1 + (1 - 0.1 / 0.7) + 0.8 + 0.6 + 0.4) / 5;

    expect(result.breakdown.successRate).toBeCloseTo(weights.w1 * 0.5, 6); // stats空 -> coldstart prior
    expect(result.breakdown.contextFit).toBeCloseTo(weights.w2 * contextFit, 6);
    expect(result.breakdown.timing).toBeCloseTo(weights.w3 * 1, 6);
    expect(result.breakdown.affinity).toBeCloseTo(weights.w4 * 0.6, 6); // affinity.perKind.get('rebooking')
    expect(result.breakdown.urgency).toBeCloseTo(weights.w5 * 0.7, 6); // priorityClass=2 -> 0.7
    expect(result.breakdown.overrideBoost).toBe(1.0);
    expect(result.breakdown.churnPenalty).toBe(1.0);

    const expectedSum =
      result.breakdown.successRate + result.breakdown.contextFit + result.breakdown.timing + result.breakdown.affinity + result.breakdown.urgency;
    expect(result.fireScore).toBeCloseTo(100 * expectedSum, 6);
  });

  describe('SuccessRate*(コールドスタートprior)', () => {
    it('n<10(executedN<10)はlaplace_rateを無視しprior=0.5を使う', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate();
      const ctx = buildCtx();
      const cellKey: CellKey = `${candidate.code}:${ctx.customerType}:evidence`;
      const stats = new Map<CellKey, CellStats>([[cellKey, { executedN: 5, acceptedN: 4, laplaceRate: 0.9, repeatRate90d: null }]]);

      const [result] = scorer.score([candidate], ctx, stats, buildWeights(), buildAffinity(), buildOverrides());
      expect(result.breakdown.successRate).toBeCloseTo(0.3 * 0.5, 6);
    });

    it('n>=10はlaplace_rateをそのまま使う', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate();
      const ctx = buildCtx();
      const cellKey: CellKey = `${candidate.code}:${ctx.customerType}:evidence`;
      const stats = new Map<CellKey, CellStats>([[cellKey, { executedN: 10, acceptedN: 8, laplaceRate: 0.8, repeatRate90d: 0.5 }]]);

      const [result] = scorer.score([candidate], ctx, stats, buildWeights(), buildAffinity(), buildOverrides());
      expect(result.breakdown.successRate).toBeCloseTo(0.3 * 0.8, 6);
    });
  });

  describe('churnPenalty境界(0.5, 0.7)', () => {
    it.each([
      [0.5, 1.0],
      [0.51, 1.4 - 0.51],
      [0.7, 1.4 - 0.7],
      [0.8, 1.0],
    ])('isSales=trueでchurnScore=%fのときpenalty=%f', (churnScore, expected) => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate({ proposalKind: 'homecare', isSales: true });
      const ctx = buildCtx({ churnScore, subscConditionsMet: 4 });

      const [result] = scorer.score([candidate], ctx, new Map(), buildWeights(), buildAffinity(), buildOverrides());
      expect(result.breakdown.churnPenalty).toBeCloseTo(expected, 6);
    });

    it('isSales=falseならグレーゾーンでもchurnPenaltyは1.0のまま', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate({ proposalKind: 'rebooking', isSales: false });
      const ctx = buildCtx({ churnScore: 0.6 });

      const [result] = scorer.score([candidate], ctx, new Map(), buildWeights(), buildAffinity(), buildOverrides());
      expect(result.breakdown.churnPenalty).toBe(1.0);
    });
  });

  describe('OverrideBoost', () => {
    it('O1 Manual Pin対象候補はoverrideBoost=1.5となり、fireScoreが1.5倍になる', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate();
      const ctx = buildCtx();
      const weights = buildWeights();
      const affinity = buildAffinity();

      const [withoutPin] = scorer.score([candidate], ctx, new Map(), weights, affinity, buildOverrides());
      const [withPin] = scorer.score([candidate], ctx, new Map(), weights, affinity, buildOverrides({ manualPin: { candidateCode: candidate.code } }));

      expect(withoutPin.breakdown.overrideBoost).toBe(1.0);
      expect(withPin.breakdown.overrideBoost).toBe(1.5);
      expect(withPin.fireScore).toBeCloseTo(withoutPin.fireScore * 1.5, 6);
    });

    it('Manual PinのcandidateCodeが他候補のものなら影響しない', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate();
      const ctx = buildCtx();

      const [result] = scorer.score([candidate], ctx, new Map(), buildWeights(), buildAffinity(), buildOverrides({ manualPin: { candidateCode: 'other-code' } }));
      expect(result.breakdown.overrideBoost).toBe(1.0);
    });
  });

  describe('重み注入(brain_params)', () => {
    it('w1=1,他=0なら fireScore = 100×SuccessRate*(他項は0)', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate();
      const ctx = buildCtx();
      const onlySuccessWeights: ScoringWeights = { w1: 1, w2: 0, w3: 0, w4: 0, w5: 0 };

      const [result] = scorer.score([candidate], ctx, new Map(), onlySuccessWeights, buildAffinity(), buildOverrides());

      expect(result.breakdown.successRate).toBeCloseTo(0.5, 6); // w1(1)×prior(0.5)
      expect(result.breakdown.contextFit).toBe(0);
      expect(result.breakdown.timing).toBe(0);
      expect(result.breakdown.affinity).toBe(0);
      expect(result.breakdown.urgency).toBe(0);
      expect(result.fireScore).toBeCloseTo(50, 6);
    });
  });

  describe('O3: churn>0.7の非販売候補はUrgency=1.0強制', () => {
    it('priorityClassに関わらずurgency項がw5×1.0になる', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate({ proposalKind: 'rebooking', isSales: false, priorityClass: 4 });
      const ctx = buildCtx({ churnScore: 0.8 });
      const weights = buildWeights();

      const [result] = scorer.score([candidate], ctx, new Map(), weights, buildAffinity(), buildOverrides());
      expect(result.breakdown.urgency).toBeCloseTo(weights.w5 * 1.0, 6);
    });

    it('churn<=0.7では通常のpriorityClassマッピング(4 -> 0.2)を使う', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate({ proposalKind: 'rebooking', isSales: false, priorityClass: 4 });
      const ctx = buildCtx({ churnScore: 0.6 });
      const weights = buildWeights();

      const [result] = scorer.score([candidate], ctx, new Map(), weights, buildAffinity(), buildOverrides());
      expect(result.breakdown.urgency).toBeCloseTo(weights.w5 * 0.2, 6);
    });
  });

  describe('ContextFit', () => {
    it('softFeatures.weightsが空の場合は中立値0.5になる', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate({ softFeatures: { weights: {}, optimalVisit: 4 } });
      const ctx = buildCtx();
      const weights = buildWeights();

      const [result] = scorer.score([candidate], ctx, new Map(), weights, buildAffinity(), buildOverrides());
      expect(result.breakdown.contextFit).toBeCloseTo(weights.w2 * 0.5, 6);
    });
  });

  describe('StaffAffinity', () => {
    it('affinity.perKindに該当proposalKindが無い場合は中立値0.5を使う', () => {
      const scorer = new PatternScorer();
      const candidate = buildCandidate({ proposalKind: 'upsell', isSales: true });
      const ctx = buildCtx();
      const weights = buildWeights();
      const affinity = buildAffinity({ perKind: new Map() });

      const [result] = scorer.score([candidate], ctx, new Map(), weights, affinity, buildOverrides());
      expect(result.breakdown.affinity).toBeCloseTo(weights.w4 * 0.5, 6);
    });
  });
});

// ================================================================
// Riora Brain Phase2 - Step8: StaffAdjustmentEngine 検証
//
// Pattern Engine Code Architecture v1.0 §12 必須観点:
// offset仮context(原ctx不変)/実測>prior優先/外舘C型document_handover/亀山mandatory=1
// ================================================================

import { describe, expect, it } from 'vitest';
import { StaffAdjustmentEngine } from '../../../src/engines/pattern/StaffAdjustmentEngine';
import type {
  Candidate,
  PatternContext,
  ScoreBreakdown,
  ScoredCandidate,
  Staff,
  StaffAdjustment,
} from '../../../src/types/riora.types';
import type { StyleAffinityTable } from '../../../src/types/brain.types';

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
    code: 'A1-step1',
    channel: 'in_store',
    patternCode: 'A1',
    stepNo: 1,
    customerType: null,
    proposalKind: 'homecare',
    isSales: true,
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

function buildStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 'staff-1',
    storeId: 'store-1',
    name: '鈴木',
    style: 'evidence',
    isActive: true,
    nameAliases: [],
    ...overrides,
  };
}

function buildAdjustment(overrides: Partial<StaffAdjustment> = {}): StaffAdjustment {
  return {
    staffId: 'staff-1',
    patternId: 'A1',
    proposalKind: 'homecare',
    timingOffset: 0,
    scriptStyle: null,
    affinityScore: null,
    ...overrides,
  };
}

function buildPriors(): StyleAffinityTable {
  return {
    evidence: { homecare: 0.5, rebooking: 0.5, subscription: 0.5, upsell: 0.5, pack: 0.5, none: 0.5 },
    theory: { homecare: 0.5, rebooking: 0.5, subscription: 0.5, upsell: 0.5, pack: 0.5, none: 0.5 },
    empathy: { homecare: 0.5, rebooking: 0.5, subscription: 0.5, upsell: 0.5, pack: 0.5, none: 0.5 },
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

function buildScored(candidateOverrides: Partial<Candidate> = {}): ScoredCandidate {
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
    fireScore: 80,
  };
}

describe('StaffAdjustmentEngine', () => {
  describe('作用点1: applyTimingOffset', () => {
    it('該当する timing_offset があれば visitCount から減算した仮contextを返し、原ctxは不変', () => {
      const engine = new StaffAdjustmentEngine();
      const ctx = buildCtx({ visitCount: 3 });
      const candidate = buildCandidate({ patternCode: 'A1', proposalKind: 'homecare' });
      const off = engine.resolveAffinity(
        buildStaff({ id: 'staff-kameyama', name: '亀山', style: 'theory' }),
        [buildAdjustment({ staffId: 'staff-kameyama', patternId: 'A1', proposalKind: 'homecare', timingOffset: 1 })],
        buildPriors()
      );

      const tempCtx = engine.applyTimingOffset(ctx, candidate, off);

      expect(tempCtx.visitCount).toBe(2); // 3 - 1
      expect(ctx.visitCount).toBe(3); // 原ctx不変
    });

    it('該当するoffsetが無い場合は同一のctxを返す(offsetなし)', () => {
      const engine = new StaffAdjustmentEngine();
      const ctx = buildCtx({ visitCount: 3 });
      const candidate = buildCandidate({ patternCode: 'B1', proposalKind: 'rebooking' });
      const off = engine.resolveAffinity(buildStaff(), [], buildPriors());

      const tempCtx = engine.applyTimingOffset(ctx, candidate, off);

      expect(tempCtx).toEqual(ctx);
    });
  });

  describe('作用点2: resolveAffinity', () => {
    it('affinity_score実測値が無い場合はstyle_affinity priorを使う', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ style: 'theory' });
      const priors = buildPriors();
      priors.theory.homecare = 0.7;

      const off = engine.resolveAffinity(staff, [], priors);

      expect(off.style).toBe('theory');
      expect(off.perKind.get('homecare')).toBe(0.7);
    });

    it('affinity_score実測値があればpriorより優先される', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-1', style: 'evidence' });
      const priors = buildPriors();
      priors.evidence.homecare = 0.5;
      const adjustments: StaffAdjustment[] = [
        buildAdjustment({ staffId: 'staff-1', patternId: 'A1', proposalKind: 'homecare', affinityScore: 0.9 }),
      ];

      const off = engine.resolveAffinity(staff, adjustments, priors);

      expect(off.perKind.get('homecare')).toBe(0.9);
    });

    it('他スタッフのaffinity_scoreは無視する', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-1', style: 'evidence' });
      const priors = buildPriors();
      priors.evidence.homecare = 0.5;
      const adjustments: StaffAdjustment[] = [
        buildAdjustment({ staffId: 'staff-other', patternId: 'A1', proposalKind: 'homecare', affinityScore: 0.99 }),
      ];

      const off = engine.resolveAffinity(staff, adjustments, priors);

      expect(off.perKind.get('homecare')).toBe(0.5);
    });

    it('timingOffsetsには timing_offset!=0 のエントリのみ `${patternId}:${kind}` で登録される', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-kameyama', name: '亀山', style: 'theory' });
      const adjustments: StaffAdjustment[] = [
        buildAdjustment({ staffId: 'staff-kameyama', patternId: 'A1', proposalKind: 'homecare', timingOffset: 1 }),
        buildAdjustment({ staffId: 'staff-kameyama', patternId: 'A2', proposalKind: 'rebooking', timingOffset: 0 }),
      ];

      const off = engine.resolveAffinity(staff, adjustments, buildPriors());

      expect(off.timingOffsets.get('A1:homecare')).toBe(1);
      expect(off.timingOffsets.has('A2:rebooking')).toBe(false);
    });

    it('亀山(名前"亀山")はmandatoryMax=1、subscriptionStyleは未設定', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-kameyama', name: '亀山', style: 'theory' });

      const off = engine.resolveAffinity(staff, [], buildPriors());

      expect(off.constraints.mandatoryMax).toBe(1);
      expect(off.constraints.subscriptionStyle).toBeUndefined();
    });

    it('外舘(名前"外舘")はsubscriptionStyle="document_handover"が設定される', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-sotodate', name: '外舘', style: 'empathy' });

      const off = engine.resolveAffinity(staff, [], buildPriors());

      expect(off.constraints.subscriptionStyle).toBe('document_handover');
      expect(off.constraints.mandatoryMax).toBe(1);
    });
  });

  describe('作用点3: applyOutputStyle', () => {
    it('scriptStyleはoff.styleそのまま、constraintsAppliedにmandatoryMaxが含まれる', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-kameyama', name: '亀山', style: 'theory' });
      const off = engine.resolveAffinity(staff, [], buildPriors());
      const proposal = buildScored({ proposalKind: 'rebooking' });

      const result = engine.applyOutputStyle(proposal, off);

      expect(result.scriptStyle).toBe('theory');
      expect(result.constraintsApplied).toContain('mandatoryMax=1');
      expect(result.constraintsApplied).not.toContain('document_handover');
    });

    it('外舘がsubscription提案を出すときconstraintsAppliedに"document_handover"が含まれる', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-sotodate', name: '外舘', style: 'empathy' });
      const off = engine.resolveAffinity(staff, [], buildPriors());
      const proposal = buildScored({ proposalKind: 'subscription' });

      const result = engine.applyOutputStyle(proposal, off);

      expect(result.scriptStyle).toBe('empathy');
      expect(result.constraintsApplied).toContain('document_handover');
      expect(result.constraintsApplied).toContain('mandatoryMax=1');
    });

    it('外舘でもsubscription以外の提案にはdocument_handoverは付与されない', () => {
      const engine = new StaffAdjustmentEngine();
      const staff = buildStaff({ id: 'staff-sotodate', name: '外舘', style: 'empathy' });
      const off = engine.resolveAffinity(staff, [], buildPriors());
      const proposal = buildScored({ proposalKind: 'homecare' });

      const result = engine.applyOutputStyle(proposal, off);

      expect(result.constraintsApplied).not.toContain('document_handover');
    });
  });
});

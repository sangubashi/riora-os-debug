// ================================================================
// Riora Brain Phase2 - Step9: ProposalOrchestrator 検証
//
// Pattern Engine Code Architecture v1.0 §8/§12 必須観点:
// DI全モックでの順序検証/Repo throw→EngineDegradedResult/不変条件違反→
// EngineDegradedResult/timing_offset反映/DM変換/決定論(同入力一致)
// ================================================================

import { describe, expect, it, vi } from 'vitest';
import { ConflictResolver } from '../../../src/engines/pattern/ConflictResolver';
import { JsonLogicEvaluator } from '../../../src/engines/pattern/JsonLogicEvaluator';
import { PatternMatcher } from '../../../src/engines/pattern/PatternMatcher';
import { PatternScorer } from '../../../src/engines/pattern/PatternScorer';
import { StaffAdjustmentEngine } from '../../../src/engines/pattern/StaffAdjustmentEngine';
import { ProposalOrchestrator, type GenerateInput, type GeneratorDeps } from '../../../src/engines/pattern/ProposalOrchestrator';
import type { IStatsRepo } from '../../../src/repositories/interfaces';
import {
  EngineInvariantError,
  type Candidate,
  type CellKey,
  type CellStats,
  type FinalProposalSet,
  type Overrides,
  type PatternContext,
  type ScoringWeights,
  type Staff,
  type StaffAdjustment,
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
    proposalKind: 'homecare',
    isSales: true,
    priorityClass: 1,
    hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} },
    baseScript: 'base script',
    cooldownVisits: 0,
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

function buildWeights(overrides: Partial<ScoringWeights> = {}): ScoringWeights {
  return { w1: 0, w2: 0, w3: 0, w4: 0, w5: 0, ...overrides };
}

function buildOverrides(overrides: Partial<Overrides> = {}): Overrides {
  return { manualPin: null, storeOverrideCodes: new Set(), ...overrides };
}

function buildStatsRepo(): IStatsRepo & { loadCells: ReturnType<typeof vi.fn> } {
  return { loadCells: vi.fn(async (_keys: CellKey[]) => new Map<CellKey, CellStats>()) };
}

function buildDeps(statsRepo: IStatsRepo): GeneratorDeps {
  const evaluator = new JsonLogicEvaluator();
  return {
    statsRepo,
    matcher: new PatternMatcher(evaluator),
    scorer: new PatternScorer(),
    resolver: new ConflictResolver(evaluator),
    staffAdjust: new StaffAdjustmentEngine(),
  };
}

function buildInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    ctx: buildCtx(),
    candidates: [],
    staff: buildStaff(),
    adjustments: [],
    weights: buildWeights(),
    styleAffinity: buildPriors(),
    overrides: buildOverrides(),
    recentOutcomes: [],
    consentDm: true,
    nowJst: '2026-06-13T10:00:00+09:00',
    ...overrides,
  };
}

/** FinalProposalSetへ絞り込む(degradedならテスト失敗させる)。 */
function expectSuccess(result: FinalProposalSet | { degraded: true; reason: string }): FinalProposalSet {
  if ('degraded' in result) {
    throw new Error(`unexpected degraded result: ${result.reason}`);
  }
  return result;
}

describe('ProposalOrchestrator', () => {
  it('正常系: in_store候補をmandatory/secondaryへ整形し、scriptStyleが反映される', async () => {
    const statsRepo = buildStatsRepo();
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));

    const sales = buildCandidate({ uid: 'cand-sales', code: 'A1-step1', proposalKind: 'homecare', isSales: true, priorityClass: 1 });
    const nonSales = buildCandidate({ uid: 'cand-rebooking', code: 'B1-step1', patternCode: 'B1', proposalKind: 'rebooking', isSales: false, priorityClass: 2 });

    const input = buildInput({
      candidates: [sales, nonSales],
      weights: buildWeights({ w5: 1 }), // fireScore = 100 * urgency(priorityClass)
      staff: buildStaff({ style: 'evidence' }),
    });

    const result = expectSuccess(await orchestrator.generateFinalProposalSet(input));

    expect(result.inStore.mandatory?.candidateCode).toBe('A1-step1');
    expect(result.inStore.mandatory?.isMandatory).toBe(true);
    expect(result.inStore.mandatory?.fireScore).toBeCloseTo(100);
    expect(result.inStore.mandatory?.scriptStyle).toBe('evidence');
    expect(result.inStore.secondary?.candidateCode).toBe('B1-step1');
    expect(result.inStore.secondary?.isMandatory).toBe(false);
    expect(result.inStore.secondary?.fireScore).toBeCloseTo(70);
    expect(result.inStore.candidateDate).toBeNull();
    expect(result.dm).toBeNull();
    expect(result.decisionRecordId).toBeNull();

    expect(statsRepo.loadCells).toHaveBeenCalledTimes(1);
    expect(statsRepo.loadCells).toHaveBeenCalledWith(['A1-step1:B_pore:evidence', 'B1-step1:B_pore:evidence']);
  });

  it('AI提案本物化: decisiveFactor/explanationが実データ(候補コード・FireScore)から算出される(固定文言・nullではない)', async () => {
    const statsRepo = buildStatsRepo();
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));

    const sales = buildCandidate({ uid: 'cand-sales', code: 'A1-step1', proposalKind: 'homecare', isSales: true, priorityClass: 1 });
    const input = buildInput({ candidates: [sales], weights: buildWeights({ w5: 1 }) });

    const result = expectSuccess(await orchestrator.generateFinalProposalSet(input));

    expect(result.inStore.mandatory?.decisiveFactor).not.toBeNull();
    expect(result.inStore.mandatory?.decisiveFactor).toContain('点');
    expect(result.explanation.staffLine1).toContain('A1-step1');
    expect(result.explanation.staffAvoid).toContain('1件まで'); // isSales=trueのため
    expect(result.explanation.managerQ1).toContain('A1-step1');
  });

  it('AI提案本物化: proposalKind=rebookingがmandatoryの場合、candidateDateを実データ(lastVisitDate+avgCycle)から算出する', async () => {
    const statsRepo = buildStatsRepo();
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));

    const rebooking = buildCandidate({ uid: 'cand-rebooking', code: 'B1-step1', proposalKind: 'rebooking', isSales: false, priorityClass: 1 });
    const input = buildInput({
      candidates: [rebooking],
      weights: buildWeights({ w5: 1 }),
      ctx: buildCtx({ avgCycle: 28, raw: { typeConfidence: 0.8, csi: 0.5, skinDeltaTrend: 0, cycleRatio: 1, lastVisitDate: '2026-06-01' } }),
    });

    const result = expectSuccess(await orchestrator.generateFinalProposalSet(input));

    expect(result.inStore.mandatory?.candidateCode).toBe('B1-step1');
    expect(result.inStore.candidateDate).toBe('2026-06-29');
  });

  it('AI提案本物化: 候補が無い場合のexplanationは「提案なし」の実情を返す(固定の提案文言は作らない)', async () => {
    const statsRepo = buildStatsRepo();
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));
    const input = buildInput({ candidates: [] });

    const result = expectSuccess(await orchestrator.generateFinalProposalSet(input));

    expect(result.inStore.mandatory).toBeNull();
    expect(result.explanation.staffLine1).toContain('発火条件を満たす提案はありません');
  });

  it('Hard gateで全候補が除外される場合、mandatory/secondary/dmはnullで不変条件違反にならない', async () => {
    const statsRepo = buildStatsRepo();
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));

    const subscription = buildCandidate({ uid: 'cand-sub', code: 'C1-step1', proposalKind: 'subscription', isSales: true });

    const input = buildInput({
      ctx: buildCtx({ subscConditionsMet: 0 }), // G-SUB: subscription候補を除外
      candidates: [subscription],
    });

    const result = expectSuccess(await orchestrator.generateFinalProposalSet(input));

    expect(result.inStore.mandatory).toBeNull();
    expect(result.inStore.secondary).toBeNull();
    expect(result.dm).toBeNull();
    expect(statsRepo.loadCells).toHaveBeenCalledWith([]);
  });

  it('statsRepo.loadCellsがthrowした場合、EngineDegradedResultへ正規化する', async () => {
    const statsRepo = buildStatsRepo();
    statsRepo.loadCells.mockRejectedValueOnce(new Error('db down'));
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));

    const input = buildInput({ candidates: [buildCandidate()] });

    const result = await orchestrator.generateFinalProposalSet(input);

    expect(result).toEqual({
      degraded: true,
      reason: 'db down',
      proposal: {
        inStore: { mandatory: null, secondary: null, candidateDate: null },
        dm: null,
        explanation: { staffLine1: '', staffAvoid: null, managerQ1: '', managerQ2: '', managerQ3: '' },
        decisionRecordId: null,
      },
    });
  });

  it('resolver.resolveのEngineInvariantErrorはEngineDegradedResultへ正規化する', async () => {
    const statsRepo = buildStatsRepo();
    const deps = buildDeps(statsRepo);
    vi.spyOn(deps.resolver, 'resolve').mockImplementation(() => {
      throw new EngineInvariantError('inStore販売系は1件以下であること', { salesCount: 2 });
    });
    const orchestrator = new ProposalOrchestrator(deps);

    const input = buildInput({ candidates: [buildCandidate()] });

    const result = await orchestrator.generateFinalProposalSet(input);

    expect(result).toMatchObject({ degraded: true, reason: 'inStore販売系は1件以下であること' });
  });

  it('timing_offsetが採点前contextに反映され、fireScoreに差が出る', async () => {
    const weights = buildWeights({ w3: 1 }); // fireScore = 100 * timing_proximity
    const candidate = buildCandidate({
      uid: 'cand-homecare',
      code: 'A1-step1',
      patternCode: 'A1',
      proposalKind: 'homecare',
      isSales: false,
      softFeatures: { weights: {}, optimalVisit: 2 },
    });
    const staff = buildStaff({ id: 'staff-kameyama', name: '亀山', style: 'theory' });
    const ctx = buildCtx({ visitCount: 3 }); // optimalVisitとの差=1 -> timing_proximity = exp(-0.5)

    // offsetなし
    const withoutOffset = expectSuccess(
      await new ProposalOrchestrator(buildDeps(buildStatsRepo())).generateFinalProposalSet(
        buildInput({ ctx, candidates: [candidate], weights, staff, adjustments: [] })
      )
    );

    // timing_offset=1 -> tempCtx.visitCount=2=optimalVisit -> timing_proximity=1
    const withOffset = expectSuccess(
      await new ProposalOrchestrator(buildDeps(buildStatsRepo())).generateFinalProposalSet(
        buildInput({
          ctx,
          candidates: [candidate],
          weights,
          staff,
          adjustments: [buildAdjustment({ staffId: 'staff-kameyama', patternId: 'A1', proposalKind: 'homecare', timingOffset: 1 })],
        })
      )
    );

    expect(withoutOffset.inStore.mandatory?.fireScore).toBeCloseTo(100 * Math.exp(-0.5));
    expect(withOffset.inStore.mandatory?.fireScore).toBeCloseTo(100);
  });

  it('DM候補はQueuedScenarioへ変換される(店内優先kindと異なる場合)', async () => {
    const statsRepo = buildStatsRepo();
    const orchestrator = new ProposalOrchestrator(buildDeps(statsRepo));

    const inStore = buildCandidate({ uid: 'cand-instore', code: 'A1-step1', proposalKind: 'homecare', isSales: true, priorityClass: 1 });
    const dm = buildCandidate({
      uid: 'cand-dm',
      code: 'S-SB-07',
      channel: 'dm',
      patternCode: null,
      stepNo: null,
      proposalKind: 'upsell',
      isSales: true,
      priorityClass: 1,
    });

    const input = buildInput({
      candidates: [inStore, dm],
      weights: buildWeights({ w5: 1 }),
      consentDm: true,
    });

    const result = expectSuccess(await orchestrator.generateFinalProposalSet(input));

    expect(result.dm).toEqual({
      scenarioId: 'S-SB-07',
      customerId: 'customer-1',
      proposalKind: 'upsell',
      status: 'pending',
    });
  });

  it('決定論: 同入力なら何度実行しても同じ結果になる', async () => {
    const sales = buildCandidate({ uid: 'cand-sales', code: 'A1-step1', proposalKind: 'homecare', isSales: true, priorityClass: 1 });
    const nonSales = buildCandidate({ uid: 'cand-rebooking', code: 'B1-step1', patternCode: 'B1', proposalKind: 'rebooking', isSales: false, priorityClass: 2 });
    const input = buildInput({ candidates: [sales, nonSales], weights: buildWeights({ w1: 0.3, w2: 0.2, w3: 0.2, w4: 0.2, w5: 0.1 }) });

    const results: (FinalProposalSet | { degraded: true; reason: string })[] = [];
    for (let i = 0; i < 20; i++) {
      const orchestrator = new ProposalOrchestrator(buildDeps(buildStatsRepo()));
      results.push(await orchestrator.generateFinalProposalSet(input));
    }

    const first = JSON.stringify(results[0]);
    for (const r of results) {
      expect(JSON.stringify(r)).toBe(first);
    }
  });
});

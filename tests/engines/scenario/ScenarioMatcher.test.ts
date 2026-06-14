// ================================================================
// Scenario Engine - Step1: ScenarioMatcher 検証
//
// Scenario Engine Code Architecture v1.0 §3/§11 必須観点:
// 順序固定(lifecycle->恒久停止->InStoreShadow->G-SUB/G-CHURN->
// fire_condition(SCENARIO_EXTRA_VARS含む)->sales_cooldown)/
// trigger一致フィルタ/shadow同種抑止/Pin販売停止/決定論
// ================================================================

import { describe, expect, it } from 'vitest';
import { JsonLogicEvaluator } from '../../../src/engines/pattern/JsonLogicEvaluator';
import {
  type InStoreShadow,
  type ScenarioCandidate,
  type ScenarioContext,
  type ScenarioTriggerInput,
  type SendHistoryItem,
} from '../../../src/engines/scenario/core/ScenarioContext';
import { ScenarioMatcher, type ScenarioMatchInput } from '../../../src/engines/scenario/pipeline/ScenarioMatcher';

function buildTrigger(overrides: Partial<ScenarioTriggerInput> = {}): ScenarioTriggerInput {
  return {
    storeId: 'store-1',
    customerId: 'customer-1',
    triggerEvent: 'no_rebooking',
    occurredOn: '2026-06-13',
    source: 'nightly',
    ...overrides,
  };
}

function buildCtx(overrides: Partial<ScenarioContext> = {}): ScenarioContext {
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
    cycleRatio: 1,
    subscPaceRatio: null,
    daysSinceHomecare: null,
    csi: 0.5,
    isVip: false,
    lastScenarioSentDays: null,
    ...overrides,
  };
}

function buildCandidate(overrides: Partial<ScenarioCandidate> = {}): ScenarioCandidate {
  return {
    uid: 'cand-1',
    code: 'L-01',
    channel: 'dm',
    patternCode: null,
    stepNo: null,
    proposalKind: 'none',
    isSales: false,
    priorityClass: 2,
    hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} },
    baseScript: 'base script',
    cooldownVisits: 0,
    lifecycleStatus: 'active',
    version: 1,
    groupCode: 'L',
    triggerEvent: 'no_rebooking',
    suppression: { globalDays: 7, sameScenarioDays: 30, sameGroupDays: 14, salesCooldownVisits: 2, allowStageProgression: false },
    tone: 'standard',
    sendDelay: 'next_morning_10',
    template: 'template text',
    templateVars: [],
    generationMode: 'template',
    successScore: 0.5,
    ...overrides,
  };
}

function buildShadow(overrides: Partial<InStoreShadow> = {}): InStoreShadow {
  return { proposalKinds: [], manualPinActive: false, ...overrides };
}

function buildHistoryItem(overrides: Partial<SendHistoryItem> = {}): SendHistoryItem {
  return { scenarioCode: 'SB-01', groupCode: 'SB', isSales: true, sentAt: '2026-06-01T10:00:00+09:00', wasApproved: false, rejectCount: 0, ...overrides };
}

function buildInput(overrides: Partial<ScenarioMatchInput> = {}): ScenarioMatchInput {
  return {
    trigger: buildTrigger(),
    ctx: buildCtx(),
    candidates: [],
    history: [],
    permanentStops: new Set(),
    shadow: buildShadow(),
    nowJst: '2026-06-13T10:00:00+09:00',
    ...overrides,
  };
}

describe('ScenarioMatcher', () => {
  it('正常系: 全ゲートを通過した候補はeligibleになる', () => {
    const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
    const candidate = buildCandidate();
    const result = matcher.match(buildInput({ candidates: [candidate] }));

    expect(result.eligible).toEqual([candidate]);
    expect(result.rejected).toEqual([]);
  });

  describe('Stage -1: trigger一致フィルタ', () => {
    it('triggerEventが一致しない候補はeligible/rejectedどちらにも含まれない', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ triggerEvent: 'subsc_started' });
      const result = matcher.match(buildInput({ trigger: buildTrigger({ triggerEvent: 'no_rebooking' }), candidates: [candidate] }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('Stage 0: lifecycleフィルタ', () => {
    it('active/testing以外のlifecycle_statusは"lifecycle"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      for (const lifecycleStatus of ['candidate', 'watch', 'demoted', 'suspended'] as const) {
        const candidate = buildCandidate({ lifecycleStatus });
        const result = matcher.match(buildInput({ candidates: [candidate] }));

        expect(result.eligible).toEqual([]);
        expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'lifecycle', detail: `lifecycle_status=${lifecycleStatus}` }]);
      }
    });

    it('lifecycle_status="testing"はisInTestingGroup(決定論的50%)でA/B判定する: 対象群はeligible', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      // customer-1:L-01 はisInTestingGroup=true(対象群)
      const candidate = buildCandidate({ code: 'L-01', lifecycleStatus: 'testing' });
      const result = matcher.match(buildInput({ candidates: [candidate] }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });

    it('lifecycle_status="testing"の対照群は"lifecycle"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      // customer-1:L-02 はisInTestingGroup=false(対照群)
      const candidate = buildCandidate({ code: 'L-02', lifecycleStatus: 'testing' });
      const result = matcher.match(buildInput({ candidates: [candidate] }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: 'L-02', blockedBy: 'lifecycle', detail: 'testing 50% split: control group' }]);
    });
  });

  describe('Stage 1: 恒久停止', () => {
    it('permanentStopsに含まれるcodeは"reject_twice_permanent"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ code: 'L-09' });
      const result = matcher.match(buildInput({ candidates: [candidate], permanentStops: new Set(['L-09']) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: 'L-09', blockedBy: 'reject_twice_permanent' }]);
    });
  });

  describe('Stage 2: InStoreShadow', () => {
    it('shadow.proposalKindsに同一proposalKindがある場合"superseded_by_instore"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'homecare' });
      const result = matcher.match(buildInput({ candidates: [candidate], shadow: buildShadow({ proposalKinds: ['homecare'] }) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'superseded_by_instore', detail: 'homecare' }]);
    });

    it('shadow.manualPinActive中の販売系候補は"manual_pin_dm_stop"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'upsell', isSales: true });
      const result = matcher.match(buildInput({ candidates: [candidate], shadow: buildShadow({ manualPinActive: true }) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'manual_pin_dm_stop' }]);
    });

    it('shadow.manualPinActive中でも非販売系候補は除外されない', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'none', isSales: false });
      const result = matcher.match(buildInput({ candidates: [candidate], shadow: buildShadow({ manualPinActive: true }) }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('Stage 3: Hard gates (G-SUB / G-CHURN)', () => {
    it('G-SUB: subscription候補はsubsc_conditions_met<4の場合"condition"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'subscription' });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ subscConditionsMet: 3 }) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'condition', detail: 'G-SUB: subsc_conditions_met=3' }]);
    });

    it('G-SUB: subsc_conditions_met=4ならsubscription候補は除外されない', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'subscription' });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ subscConditionsMet: 4 }) }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });

    it('G-CHURN: churn_score>0.7の販売系候補は"churn_sales_block"で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'upsell', isSales: true });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ churnScore: 0.8 }) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'churn_sales_block', detail: 'churn_score=0.8' }]);
    });

    it('G-CHURN: churn_score>0.7でも非販売系候補は除外されない', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'none', isSales: false });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ churnScore: 0.8 }) }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('Stage 4: fire_condition', () => {
    it('hardConditionがfalseの場合"condition"で除外する(detailは無し)', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ hardCondition: { '==': [1, 2] } });
      const result = matcher.match(buildInput({ candidates: [candidate] }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'condition', detail: undefined }]);
    });

    it('hardConditionの評価で例外が発生した場合は"condition"+detail=errorで除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ hardCondition: { unknown_operator_xyz: [1, 2] } });
      const result = matcher.match(buildInput({ candidates: [candidate] }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.blockedBy).toBe('condition');
      expect(result.rejected[0]?.detail).toBeTruthy();
    });

    it('hardConditionからSCENARIO_EXTRA_VARS(cycle_ratio)を参照できる: 条件成立でeligible', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ hardCondition: { '>': [{ var: 'cycle_ratio' }, 1.5] } });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ cycleRatio: 2.0 }) }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });

    it('hardConditionからSCENARIO_EXTRA_VARS(cycle_ratio)を参照できる: 条件不成立で"condition"', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ hardCondition: { '>': [{ var: 'cycle_ratio' }, 1.5] } });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ cycleRatio: 1.0 }) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'condition', detail: undefined }]);
    });
  });

  describe('Stage 5: Cooldown (sales_cooldown)', () => {
    it('homecare_declined_recent && isSalesの場合"sales_cooldown"(detail=homecare_declined_recent)で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'upsell', isSales: true });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ homecareDeclinedRecent: true }) }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'sales_cooldown', detail: 'homecare_declined_recent' }]);
    });

    it('homecare_declined_recentでも非販売系候補は除外されない', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'none', isSales: false });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ homecareDeclinedRecent: true }) }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });

    it('サブスク提案が直近30日以内に拒否されたhistoryがある場合"sales_cooldown"(detail=subsc_declined_30d)で除外する', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'subscription' });
      const history = [buildHistoryItem({ groupCode: 'SB', rejectCount: 1, sentAt: '2026-06-01T10:00:00+09:00' })]; // 12日前
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ subscConditionsMet: 4 }), history, nowJst: '2026-06-13T10:00:00+09:00' }));

      expect(result.eligible).toEqual([]);
      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'sales_cooldown', detail: 'subsc_declined_30d' }]);
    });

    it('サブスク拒否historyが30日より前の場合は除外されない', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'subscription' });
      const history = [buildHistoryItem({ groupCode: 'SB', rejectCount: 1, sentAt: '2026-04-01T10:00:00+09:00' })]; // 73日前
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ subscConditionsMet: 4 }), history, nowJst: '2026-06-13T10:00:00+09:00' }));

      expect(result.eligible).toEqual([candidate]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('順序固定(blockedBy正確性)', () => {
    it('lifecycle不適合かつpermanentStopsにも該当する場合は"lifecycle"が優先される', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ code: 'L-09', lifecycleStatus: 'suspended' });
      const result = matcher.match(buildInput({ candidates: [candidate], permanentStops: new Set(['L-09']) }));

      expect(result.rejected).toEqual([{ code: 'L-09', blockedBy: 'lifecycle', detail: 'lifecycle_status=suspended' }]);
    });

    it('InStoreShadowとG-CHURNの両方に該当する場合は"superseded_by_instore"が優先される', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'homecare', isSales: true });
      const result = matcher.match(
        buildInput({ candidates: [candidate], shadow: buildShadow({ proposalKinds: ['homecare'] }), ctx: buildCtx({ churnScore: 0.9 }) })
      );

      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'superseded_by_instore', detail: 'homecare' }]);
    });

    it('G-CHURNとfire_condition不成立の両方に該当する場合は"churn_sales_block"が優先される', () => {
      const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
      const candidate = buildCandidate({ proposalKind: 'upsell', isSales: true, hardCondition: { '==': [1, 2] } });
      const result = matcher.match(buildInput({ candidates: [candidate], ctx: buildCtx({ churnScore: 0.9 }) }));

      expect(result.rejected).toEqual([{ code: candidate.code, blockedBy: 'churn_sales_block', detail: 'churn_score=0.9' }]);
    });
  });

  it('複数候補: eligibleとrejectedが候補ごとに正しく振り分けられる', () => {
    const matcher = new ScenarioMatcher(new JsonLogicEvaluator());
    const ok = buildCandidate({ uid: 'cand-ok', code: 'L-01', proposalKind: 'none' });
    const blocked = buildCandidate({ uid: 'cand-blocked', code: 'L-09', proposalKind: 'subscription' });
    const result = matcher.match(buildInput({ candidates: [ok, blocked], ctx: buildCtx({ subscConditionsMet: 2 }) }));

    expect(result.eligible).toEqual([ok]);
    expect(result.rejected).toEqual([{ code: 'L-09', blockedBy: 'condition', detail: 'G-SUB: subsc_conditions_met=2' }]);
  });

  it('決定論: 同入力なら何度実行しても同じ結果になる', () => {
    const candidate = buildCandidate({ proposalKind: 'homecare', isSales: true });
    const input = buildInput({ candidates: [candidate] });

    const results = Array.from({ length: 20 }, () => new ScenarioMatcher(new JsonLogicEvaluator()).match(input));

    const first = JSON.stringify(results[0]);
    for (const r of results) {
      expect(JSON.stringify(r)).toBe(first);
    }
  });
});

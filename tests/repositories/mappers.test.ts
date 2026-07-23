// ================================================================
// Riora Brain Phase2 - Step3: Repository mappers(snake_case→camelCase)検証
// ================================================================

import { describe, expect, it } from 'vitest';
import {
  cellKeyOf,
  toCandidate,
  toCandidates,
  toCellStats,
  toLastSentMap,
  toOutcomeLite,
  toScoringWeights,
  toStyleAffinityTable,
  type BrainSentScenarioRow,
  type PatternStepRow,
  type ProposalOutcomeRow,
  type SuccessPatternRow,
} from '../../src/repositories/supabase/mappers';

describe('mappers', () => {
  describe('toCandidate / toCandidates', () => {
    const pattern: SuccessPatternRow = {
      id: 'B1',
      lifecycle_status: 'active',
      version: 2,
      customer_type: 'B_pore',
      brain_pattern_steps: [
        {
          id: 'step-uuid-1',
          step_no: 2,
          proposal_kind: 'homecare',
          fire_condition: { '==': [1, 1] },
          base_script: 'ホームケアの提案です',
          cooldown_visits: 2,
          soft_features: { weights: { cycle_position: 0.3, condition_margin: 0.2 } },
          optimal_visit: 2,
        },
        {
          id: 'step-uuid-2',
          step_no: 4,
          proposal_kind: 'subscription',
          fire_condition: { '==': [1, 1] },
          base_script: 'サブスクの提案です',
          cooldown_visits: 3,
          soft_features: null,
          optimal_visit: null,
        },
      ],
    };

    it('pattern×step を Candidate にフラット化する(code/uid/patternCode/stepNo)', () => {
      const candidates = toCandidates(pattern);
      expect(candidates).toHaveLength(2);

      const homecare = candidates[0];
      expect(homecare.uid).toBe('step-uuid-1');
      expect(homecare.code).toBe('B1-step2');
      expect(homecare.channel).toBe('in_store');
      expect(homecare.patternCode).toBe('B1');
      expect(homecare.stepNo).toBe(2);
      expect(homecare.customerType).toBe('B_pore');
      expect(homecare.lifecycleStatus).toBe('active');
      expect(homecare.version).toBe(2);
    });

    it('proposal_kindからisSales/priorityClassを導出する', () => {
      const [homecare, subscription] = toCandidates(pattern);

      expect(homecare.proposalKind).toBe('homecare');
      expect(homecare.isSales).toBe(true);
      expect(homecare.priorityClass).toBe(3);

      expect(subscription.proposalKind).toBe('subscription');
      expect(subscription.isSales).toBe(true);
      expect(subscription.priorityClass).toBe(1);
    });

    it('rebooking/noneはisSales=falseになる', () => {
      const rebookingStep: PatternStepRow = {
        id: 'step-uuid-3',
        step_no: 1,
        proposal_kind: 'rebooking',
        fire_condition: { '==': [1, 1] },
        base_script: '',
        cooldown_visits: 2,
        soft_features: null,
        optimal_visit: 1,
      };
      const candidate = toCandidate(pattern, rebookingStep);
      expect(candidate.isSales).toBe(false);
      expect(candidate.priorityClass).toBe(2);
    });

    it('soft_features.weightsが無ければ空オブジェクト、optimal_visitが無ければoptimalVisitを省略する', () => {
      const [, subscription] = toCandidates(pattern);
      expect(subscription.softFeatures.weights).toEqual({});
      expect(subscription.softFeatures.optimalVisit).toBeUndefined();

      const [homecare] = toCandidates(pattern);
      expect(homecare.softFeatures.weights).toEqual({ cycle_position: 0.3, condition_margin: 0.2 });
      expect(homecare.softFeatures.optimalVisit).toBe(2);
    });
  });

  describe('cellKeyOf / toCellStats', () => {
    it('candidate_code:customer_type:staff_style の形式でキーを組み立てる', () => {
      const row = {
        candidate_code: 'C1-step99',
        customer_type: 'C_sensitive',
        staff_style: 'theory',
        executed_n: 3,
        accepted_n: 2,
        laplace_rate: '0.5',
        repeat_rate_90d: null,
      };
      expect(cellKeyOf(row)).toBe('C1-step99:C_sensitive:theory');
    });

    it('laplace_rate/repeat_rate_90dを数値に変換する(numeric→string対策)', () => {
      const stats = toCellStats({
        candidate_code: 'C1-step99',
        customer_type: 'C_sensitive',
        staff_style: 'theory',
        executed_n: 3,
        accepted_n: 2,
        laplace_rate: '0.5',
        repeat_rate_90d: '0.25',
      });
      expect(stats).toEqual({ executedN: 3, acceptedN: 2, laplaceRate: 0.5, repeatRate90d: 0.25 });
    });

    it('repeat_rate_90d=nullはnullのまま保持する', () => {
      const stats = toCellStats({
        candidate_code: 'C1-step99',
        customer_type: 'C_sensitive',
        staff_style: 'theory',
        executed_n: 3,
        accepted_n: 2,
        laplace_rate: 0.5,
        repeat_rate_90d: null,
      });
      expect(stats.repeatRate90d).toBeNull();
    });
  });

  describe('toScoringWeights / toStyleAffinityTable', () => {
    it('brain_paramsのvalueをそのままScoringWeights/StyleAffinityTableとして返す', () => {
      const weightsValue = { w1: 0.3, w2: 0.2, w3: 0.2, w4: 0.15, w5: 0.15 };
      expect(toScoringWeights(weightsValue)).toEqual(weightsValue);

      const affinityValue = {
        evidence: { homecare: 0.5, rebooking: 0.5, subscription: 0.5, upsell: 0.5, pack: 0.5, none: 0.5 },
        theory: { homecare: 0.5, rebooking: 0.5, subscription: 0.5, upsell: 0.5, pack: 0.5, none: 0.5 },
        empathy: { homecare: 0.5, rebooking: 0.5, subscription: 0.5, upsell: 0.5, pack: 0.5, none: 0.5 },
      };
      expect(toStyleAffinityTable(affinityValue)).toEqual(affinityValue);
    });
  });

  describe('toOutcomeLite', () => {
    it('brain_proposal_outcomes行をOutcomeLiteへ変換する', () => {
      const row: ProposalOutcomeRow = {
        pattern_id: 'B1',
        step_no: 2,
        proposal_kind: 'homecare',
        visit_count_at: 2,
        was_executed: true,
        was_accepted: true,
        created_at: '2026-06-12T00:00:00Z',
      };
      expect(toOutcomeLite(row)).toEqual({
        patternId: 'B1',
        stepNo: 2,
        proposalKind: 'homecare',
        visitCountAt: 2,
        wasExecuted: true,
        wasAccepted: true,
        occurredAt: '2026-06-12T00:00:00Z',
      });
    });
  });

  describe('toLastSentMap', () => {
    it('空配列の場合は空のMapを返す', () => {
      expect(toLastSentMap([])).toEqual(new Map());
    });

    it('trigger_type別にcreated_atをMapへ格納する', () => {
      const rows: BrainSentScenarioRow[] = [
        { trigger_type: 'scenario-A', created_at: '2026-06-10T00:00:00Z' },
        { trigger_type: 'scenario-B', created_at: '2026-06-11T00:00:00Z' },
      ];
      expect(toLastSentMap(rows)).toEqual(
        new Map([
          ['scenario-A', '2026-06-10T00:00:00Z'],
          ['scenario-B', '2026-06-11T00:00:00Z'],
        ])
      );
    });

    it('同一trigger_typeの複数行からは最新のcreated_atを採用する', () => {
      const rows: BrainSentScenarioRow[] = [
        { trigger_type: 'scenario-A', created_at: '2026-06-01T00:00:00Z' },
        { trigger_type: 'scenario-A', created_at: '2026-06-10T00:00:00Z' },
        { trigger_type: 'scenario-A', created_at: '2026-06-05T00:00:00Z' },
      ];
      expect(toLastSentMap(rows).get('scenario-A')).toBe('2026-06-10T00:00:00Z');
    });
  });
});

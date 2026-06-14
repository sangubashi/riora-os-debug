// ================================================================
// Riora Brain Phase2 - Step4: JsonLogicEvaluator 検証
//
// Pattern Engine Code Architecture v1.0 §12 必須観点:
// 未知演算子/未知変数/例外→false/evaluateManyのdata1回変換/validationCache hit
// ================================================================

import { describe, expect, it } from 'vitest';
import { CONTEXT_VARS, JsonLogicEvaluator, toSnakeData } from '../../../src/engines/pattern/JsonLogicEvaluator';
import type { PatternContext } from '../../../src/types/riora.types';

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

describe('JsonLogicEvaluator', () => {
  describe('validate', () => {
    it('許可された演算子・変数のみのルールはエラー無し([])', () => {
      const evaluator = new JsonLogicEvaluator();
      const rule = { '==': [{ var: 'subsc_conditions_met' }, 4] };
      expect(evaluator.validate(rule, CONTEXT_VARS)).toEqual([]);
    });

    it('未知変数を参照するルールは "unknown variable" を返す', () => {
      const evaluator = new JsonLogicEvaluator();
      const rule = { '==': [{ var: 'not_a_real_var' }, 4] };
      const errors = evaluator.validate(rule, CONTEXT_VARS);
      expect(errors).toEqual(['unknown variable: not_a_real_var']);
    });

    it('ALLOWED_OPS外の演算子は "forbidden operator" を返す', () => {
      const evaluator = new JsonLogicEvaluator();
      const rule = { map: [{ var: 'retail_total' }, { '+': [1] }] };
      const errors = evaluator.validate(rule, CONTEXT_VARS);
      expect(errors).toContain('forbidden operator: map');
    });

    it('validationCache: 同一ruleの2回目はキャッシュされた配列を再利用する', () => {
      const evaluator = new JsonLogicEvaluator();
      const rule = { '>': [{ var: 'churn_score' }, 0.7] };
      const first = evaluator.validate(rule, CONTEXT_VARS);
      const second = evaluator.validate(rule, CONTEXT_VARS);
      expect(second).toBe(first); // 同一参照 = cache hit
    });
  });

  describe('evaluateMany', () => {
    it('複数ルールを1つのctxに対して評価し、それぞれ正しいfiredを返す', () => {
      const evaluator = new JsonLogicEvaluator();
      const ctx = buildCtx({ subscConditionsMet: 4, churnScore: 0.1, visitCount: 4 });

      const result = evaluator.evaluateMany(
        [
          { key: 'sub-ok', rule: { '==': [{ var: 'subsc_conditions_met' }, 4] } },
          { key: 'sub-fail', rule: { '==': [{ var: 'subsc_conditions_met' }, 3] } },
          { key: 'churn-high', rule: { '>': [{ var: 'churn_score' }, 0.7] } },
          {
            key: 'and-rule',
            rule: { and: [{ '==': [{ var: 'visit_count' }, 4] }, { '!=': [{ var: 'churn_score' }, 0.7] }] },
          },
        ],
        ctx
      );

      expect(result.get('sub-ok')).toEqual({ fired: true });
      expect(result.get('sub-fail')).toEqual({ fired: false });
      expect(result.get('churn-high')).toEqual({ fired: false });
      expect(result.get('and-rule')).toEqual({ fired: true });
    });

    it('評価時に例外が発生したルールは fired:false + error を返し、他のルールは続行する', () => {
      const evaluator = new JsonLogicEvaluator();
      const ctx = buildCtx();

      // 未知演算子はjsonLogic.applyが Error("Unrecognized operation ...") を投げる
      // (validateで弾かれるはずだが、evaluateMany自身もtotal functionとして防御する)
      const throwingRule = { unknown_operator_xyz: [1, 2] };

      const result = evaluator.evaluateMany(
        [
          { key: 'throwing', rule: throwingRule },
          { key: 'ok', rule: { '==': [{ var: 'visit_count' }, 4] } },
        ],
        ctx
      );

      expect(result.get('throwing')?.fired).toBe(false);
      expect(result.get('throwing')?.error).toBeTruthy();
      expect(result.get('ok')).toEqual({ fired: true });
    });

    it('全ルールが同一のctx変換結果(toSnakeData)に対して評価される', () => {
      const evaluator = new JsonLogicEvaluator();
      const ctx = buildCtx({ daysSinceLast: 45, weddingDaysLeft: 10 });
      const expectedData = toSnakeData(ctx);

      const result = evaluator.evaluateMany(
        [
          { key: 'days', rule: { '==': [{ var: 'days_since_last' }, expectedData.days_since_last] } },
          { key: 'wedding', rule: { '==': [{ var: 'wedding_days_left' }, expectedData.wedding_days_left] } },
        ],
        ctx
      );

      expect(result.get('days')).toEqual({ fired: true });
      expect(result.get('wedding')).toEqual({ fired: true });
    });
  });

  describe('toSnakeData', () => {
    it('PatternContextのHard変数をsnake_caseへ変換する', () => {
      const ctx = buildCtx({
        visitCount: 3,
        daysSinceLast: 20,
        avgCycle: 28,
        isNominationStreak2: true,
        homecarePurchasedEver: true,
        homecareDeclinedRecent: false,
        skinImproved: true,
        skinStagnant2: false,
        subscConditionsMet: 2,
        churnScore: 0.4,
        nextBookingMadeLast: false,
        weddingDaysLeft: 14,
        retailTotal: 12000,
      });

      expect(toSnakeData(ctx)).toEqual({
        visit_count: 3,
        days_since_last: 20,
        avg_cycle: 28,
        is_nomination_streak2: true,
        homecare_purchased_ever: true,
        homecare_declined_recent: false,
        skin_improved: true,
        skin_stagnant2: false,
        subsc_conditions_met: 2,
        churn_score: 0.4,
        next_booking_made_last: false,
        wedding_days_left: 14,
        retail_total: 12000,
      });
    });
  });
});

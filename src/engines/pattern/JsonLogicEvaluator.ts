// ================================================================
// JsonLogicEvaluator (Pattern Engine Code Architecture v1.0 §3)
//
// 責務: json-logic-jsの安全ラッパ。ドメイン知識(PatternContextの意味)は
// 持たない — Hard condition(fire_condition/entry_condition)の構文検証と
// 評価のみを行う総関数(total function)。例外は投げない。
//
// validate: 未知演算子(ALLOWED_OPS外)・未知変数(allowedVars外)を列挙する。
//   結果はrule単位でキャッシュ(validationCache)し、候補マスタ読込時の
//   1回だけの検証で十分なようにする。
// evaluateMany: PatternContextをsnake_caseへ1回だけ変換し、N候補のルールを
//   一括評価する。評価例外は{fired:false, error}に倒す(誤発火より誤沈黙)。
// ================================================================

import jsonLogic from 'json-logic-js';
import type { JsonLogicRule, PatternContext } from '../../types/riora.types';

/** 許可する演算子のホワイトリスト(Pattern Engine実装設計v1 §3)。未知演算子は検証エラー。 */
const ALLOWED_OPS = new Set([
  'and', 'or', '!', '!=', '==', '===', '>', '>=', '<', '<=', 'var', 'in', '+', '-', '*', 'min', 'max', 'if',
]);

/** DB内ルール(fire_condition/entry_condition)が参照できる変数の唯一の定義。 */
export const CONTEXT_VARS: ReadonlySet<string> = new Set([
  'visit_count',
  'days_since_last',
  'avg_cycle',
  'is_nomination_streak2',
  'homecare_purchased_ever',
  'homecare_declined_recent',
  'skin_improved',
  'skin_stagnant2',
  'subsc_conditions_met',
  'churn_score',
  'next_booking_made_last',
  'wedding_days_left',
  'retail_total',
]);

/** PatternContext(camelCase)のHard変数をsnake_caseフラットオブジェクトへ変換する。 */
export function toSnakeData(ctx: PatternContext): Record<string, unknown> {
  return {
    visit_count: ctx.visitCount,
    days_since_last: ctx.daysSinceLast,
    avg_cycle: ctx.avgCycle,
    is_nomination_streak2: ctx.isNominationStreak2,
    homecare_purchased_ever: ctx.homecarePurchasedEver,
    homecare_declined_recent: ctx.homecareDeclinedRecent,
    skin_improved: ctx.skinImproved,
    skin_stagnant2: ctx.skinStagnant2,
    subsc_conditions_met: ctx.subscConditionsMet,
    churn_score: ctx.churnScore,
    next_booking_made_last: ctx.nextBookingMadeLast,
    wedding_days_left: ctx.weddingDaysLeft,
    retail_total: ctx.retailTotal,
  };
}

/** ruleの構造を正準化(キー順を揃えてJSON化)し、validationCacheのキーに使う。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface EvaluationResult {
  fired: boolean;
  error?: string;
}

export class JsonLogicEvaluator {
  private readonly validationCache = new Map<string, string[]>();

  /**
   * ルール構文検証: 未知演算子・未知変数を列挙する(空配列=合格)。
   * 同一ruleに対する2回目以降の呼び出しはvalidationCacheから即返却する。
   */
  validate(rule: JsonLogicRule, allowedVars: ReadonlySet<string>): string[] {
    const hash = stableStringify(rule);
    const cached = this.validationCache.get(hash);
    if (cached) return cached;

    const errors: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (const [op, args] of Object.entries(node as Record<string, unknown>)) {
        if (op === 'var') {
          const name = Array.isArray(args) ? args[0] : args;
          if (typeof name !== 'string' || !allowedVars.has(name)) {
            errors.push(`unknown variable: ${String(name)}`);
          }
        } else if (!ALLOWED_OPS.has(op)) {
          errors.push(`forbidden operator: ${op}`);
        }
        walk(args);
      }
    };
    walk(rule);

    this.validationCache.set(hash, errors);
    return errors;
  }

  /**
   * 1顧客×N候補の一括評価(推奨エントリ)。
   * ctxのsnake_case変換は1回のみ行い、各ruleはjsonLogic.apply()===trueで判定する。
   * 評価例外は当該キーのみ{fired:false, error}に倒す(Evaluator自身はthrowしない)。
   * extraData: Scenario Engine等がCONTEXT_VARS以外の追加変数(SCENARIO_EXTRA_VARS)を
   * 一時的に合成するための任意拡張(Pattern Engineからの既存呼び出しは省略可)。
   */
  evaluateMany(rules: Array<{ key: string; rule: JsonLogicRule }>, ctx: PatternContext, extraData?: Record<string, unknown>): Map<string, EvaluationResult> {
    const data = { ...toSnakeData(ctx), ...extraData };
    const result = new Map<string, EvaluationResult>();
    for (const { key, rule } of rules) {
      try {
        result.set(key, { fired: jsonLogic.apply(rule as never, data) === true });
      } catch (e) {
        result.set(key, { fired: false, error: e instanceof Error ? e.message : 'evaluation failed' });
      }
    }
    return result;
  }
}

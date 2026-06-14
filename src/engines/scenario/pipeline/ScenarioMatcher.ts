// ================================================================
// ScenarioMatcher (Scenario Engine Code Architecture v1.0 §3) - Step1
//
// 候補抽出+Hard Gate+InStoreShadow+G-SUB/G-CHURN+fire_condition+
// sales_cooldownを担当。順序固定(blockedBy正確性のため):
//
//   -1. trigger一致フィルタ(rejected対象外。このtriggerに該当しない
//       候補は評価そのものを行わない)
//    0. lifecycle: active/testing以外を除外。testingはPattern Engineの
//       isInTestingGroup(決定論的50%)を共用する -> 'lifecycle'
//    1. 恒久停止: permanentStops.has(code) -> 'reject_twice_permanent'
//    2. InStoreShadow:
//       shadow.proposalKindsに同一proposalKind -> 'superseded_by_instore'
//       shadow.manualPinActive && c.isSales    -> 'manual_pin_dm_stop'
//    3. Hard gates(Pattern EngineのG-SUB/G-CHURN相当):
//       G-SUB:   proposalKind==='subscription' && subscConditionsMet<4
//                -> 'condition'(detail='G-SUB: ...')
//       G-CHURN: churnScore>0.7 && c.isSales -> 'churn_sales_block'
//    4. fire_condition: evaluator.evaluateMany(hardCondition,
//       CONTEXT_VARS ∪ SCENARIO_EXTRA_VARS) -> 'condition'
//       (評価error -> falseに倒す + detail=error)
//    5. Cooldown(sales_cooldown):
//       homecareDeclinedRecent && c.isSales -> detail='homecare_declined_recent'
//       proposalKind==='subscription' && history(groupCode='SB'のreject
//         30日以内) -> detail='subsc_declined_30d'
//
// Step1範囲外(未実装・後続Stepの責務としてコメントで明示):
//   - freq_7d / same_scenario_30d / same_group_14d:
//     §3 stage5「抑制」のうちこれらは「他候補との優先度比較」
//     (freq_7dのpriority1割込判定)や「群Lの段階進行例外」など
//     ScenarioPriorityResolver(Step2)が候補集合全体を見て解決する設計のため、
//     本Matcherでは判定しない。
//   - quiet_hours: sendDelay解決後のscheduledAt補正はLineQueueBuilder(Step3)の
//     責務であり、Matcherはeligible/rejectedの形では表現しない。
//   - customer_type一致(§3 stage0): ScenarioCandidateにcustomerType相当の
//     フィールドが存在しないため、本実装では評価しない
//     (fire_conditionに含めるか型拡張するかは将来の検討課題)。
//   - idempotent / priority_superseded: ExecutionService/PriorityResolverが
//     付与するblockedByであり、Matcherが生成することはない。
// ================================================================

import { isInTestingGroup } from '../../pattern/PatternMatcher';
import type { JsonLogicEvaluator } from '../../pattern/JsonLogicEvaluator';
import {
  toScenarioExtraData,
  type InStoreShadow,
  type ISODateTime,
  type ScenarioCandidate,
  type ScenarioContext,
  type ScenarioRejectedCandidate,
  type ScenarioTriggerInput,
  type SendHistoryItem,
} from '../core/ScenarioContext';

/** 「サブスク提案拒否30日」(§3 stage5 sales_cooldown)の判定窓。 */
const SUBSC_DECLINED_COOLDOWN_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScenarioMatchInput {
  trigger: ScenarioTriggerInput;
  ctx: ScenarioContext;
  candidates: ScenarioCandidate[]; // processCache(Pattern Engineと同戦略)
  history: SendHistoryItem[];
  permanentStops: ReadonlySet<string>;
  shadow: InStoreShadow;
  nowJst: ISODateTime;
}

export interface ScenarioMatchResult {
  eligible: ScenarioCandidate[];
  rejected: ScenarioRejectedCandidate[];
}

/** groupCode='SB'の送信履歴がnowJstから30日以内に拒否(rejectCount>0)されているか。 */
function hasSubscDeclined30d(history: SendHistoryItem[], nowJst: ISODateTime): boolean {
  const now = new Date(nowJst).getTime();
  return history.some(
    (h) => h.groupCode === 'SB' && h.rejectCount > 0 && now - new Date(h.sentAt).getTime() <= SUBSC_DECLINED_COOLDOWN_DAYS * MS_PER_DAY
  );
}

export class ScenarioMatcher {
  constructor(private readonly evaluator: JsonLogicEvaluator) {} // Pattern coreを共用

  match(input: ScenarioMatchInput): ScenarioMatchResult {
    const { trigger, ctx, candidates, history, permanentStops, shadow, nowJst } = input;
    const rejected: ScenarioRejectedCandidate[] = [];
    const survivors: ScenarioCandidate[] = [];

    // Stage -1: trigger一致フィルタ(該当しない候補はrejected対象外)
    const applicable = candidates.filter((c) => c.triggerEvent === trigger.triggerEvent);

    for (const c of applicable) {
      // --- Stage 0: lifecycleフィルタ ---
      if (c.lifecycleStatus !== 'active' && c.lifecycleStatus !== 'testing') {
        rejected.push({ code: c.code, blockedBy: 'lifecycle', detail: `lifecycle_status=${c.lifecycleStatus}` });
        continue;
      }
      if (c.lifecycleStatus === 'testing' && !isInTestingGroup(ctx.customerId, c.code)) {
        rejected.push({ code: c.code, blockedBy: 'lifecycle', detail: 'testing 50% split: control group' });
        continue;
      }

      // --- Stage 1: 恒久停止 ---
      if (permanentStops.has(c.code)) {
        rejected.push({ code: c.code, blockedBy: 'reject_twice_permanent' });
        continue;
      }

      // --- Stage 2: InStoreShadow ---
      if (shadow.proposalKinds.includes(c.proposalKind)) {
        rejected.push({ code: c.code, blockedBy: 'superseded_by_instore', detail: c.proposalKind });
        continue;
      }
      if (shadow.manualPinActive && c.isSales) {
        rejected.push({ code: c.code, blockedBy: 'manual_pin_dm_stop' });
        continue;
      }

      // --- Stage 3: Hard gates (G-SUB -> G-CHURN) ---
      if (c.proposalKind === 'subscription' && ctx.subscConditionsMet < 4) {
        rejected.push({ code: c.code, blockedBy: 'condition', detail: `G-SUB: subsc_conditions_met=${ctx.subscConditionsMet}` });
        continue;
      }
      if (ctx.churnScore > 0.7 && c.isSales) {
        rejected.push({ code: c.code, blockedBy: 'churn_sales_block', detail: `churn_score=${ctx.churnScore}` });
        continue;
      }

      survivors.push(c);
    }

    // --- Stage 4: fire_condition(一括評価。CONTEXT_VARS ∪ SCENARIO_EXTRA_VARS) ---
    const extraData = toScenarioExtraData(ctx);
    const results = this.evaluator.evaluateMany(
      survivors.map((c) => ({ key: c.uid, rule: c.hardCondition })),
      ctx,
      extraData
    );

    const afterCondition: ScenarioCandidate[] = [];
    for (const c of survivors) {
      const r = results.get(c.uid);
      if (r?.fired) {
        afterCondition.push(c);
      } else {
        rejected.push({ code: c.code, blockedBy: 'condition', detail: r?.error });
      }
    }

    // --- Stage 5: Cooldown(sales_cooldown) ---
    const subscDeclined30d = hasSubscDeclined30d(history, nowJst);
    const eligible: ScenarioCandidate[] = [];
    for (const c of afterCondition) {
      if (c.isSales && ctx.homecareDeclinedRecent) {
        rejected.push({ code: c.code, blockedBy: 'sales_cooldown', detail: 'homecare_declined_recent' });
        continue;
      }
      if (c.proposalKind === 'subscription' && subscDeclined30d) {
        rejected.push({ code: c.code, blockedBy: 'sales_cooldown', detail: 'subsc_declined_30d' });
        continue;
      }
      eligible.push(c);
    }

    return { eligible, rejected };
  }
}

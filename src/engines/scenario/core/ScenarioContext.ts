// ================================================================
// ScenarioContext (Scenario Engine Code Architecture v1.0 §2 共有型)
//
// DM層の共有型。PatternContext/Candidateを拡張し、JSON Logic評価で
// 参照可能なDM固有変数(SCENARIO_EXTRA_VARS)を追加する。
//
// 評価基盤(JsonLogicEvaluator)はPattern Engine core/から共用する
// (§1依存規則: 再実装禁止)。SCENARIO_EXTRA_VARSはJsonLogicEvaluatorの
// CONTEXT_VARS(toSnakeData)には含まれないため、toScenarioExtraData()で
// 別途snake_case化し、evaluateMany()の第3引数(extraData)として渡す。
//
// Step1範囲: ScenarioMatcherが直接利用する型のみ定義する。
// SelectionResult/ScenarioDecisionRecord/IScenarioRepo等のRepository
// interfaceは後続Stepで必要になった時点で追加する。
// ================================================================

import type { Candidate, PatternContext, ProposalKind, UUID } from '../../../types/riora.types';

export type DateStr = string; // 'YYYY-MM-DD'
export type ISODateTime = string;

export type TriggerEvent =
  | 'first_visit_done' | 'no_rebooking' | 'considering' | 'proposal_declined'
  | 'peeling_done' | 'pre_visit_boost' | 'skin_improved'
  | 'cycle_over_1_5' | 'cycle_over_2_0' | 'cycle_over_2_5'
  | 'subsc_cond_3' | 'subsc_cond_4_unclosed' | 'subsc_started'
  | 'subsc_monthly_first' | 'subsc_pace_drop' | 'subsc_cancelled_30d'
  | 'homecare_14d' | 'crosssell_ready' | 'hc_intro_ready' | 'd_rebound_14d'
  | 'csi_75' | 'csi_80' | 'review_ready' | 'vip_quarterly' | 'anniversary'
  | 'birthday_month' | 'season_summer' | 'season_winter' | 'season_pollen'
  | 'memo_keyword_event' | 'memo_keyword_busy' | 'memo_keyword_life'
  | 'e1_milestone_90' | 'e1_milestone_30' | 'e1_milestone_7' | 'e1_reborn_30d';

export interface ScenarioTriggerInput {
  storeId: UUID;
  customerId: UUID;
  triggerEvent: TriggerEvent;
  occurredOn: DateStr; // 冪等キーの一部
  payload?: Record<string, unknown>; // 例: { paceRatio: 1.6 }
  source: 'sync' | 'nightly' | 'monthly'; // 発火3系統(Event Flow)
}

export interface ScenarioContext extends PatternContext {
  // DM拡張変数(JSON Logic参照可・SCENARIO_EXTRA_VARSとしてsnake_case変換に追加登録)
  cycleRatio: number;
  subscPaceRatio: number | null;
  daysSinceHomecare: number | null;
  csi: number;
  isVip: boolean;
  lastScenarioSentDays: number | null;
}

/** ScenarioContextのDM拡張変数(snake_case)。CONTEXT_VARSに追加してfire_conditionから参照可能にする。 */
export const SCENARIO_EXTRA_VARS: ReadonlySet<string> = new Set([
  'cycle_ratio',
  'subsc_pace_ratio',
  'days_since_homecare',
  'csi',
  'is_vip',
  'last_scenario_sent_days',
]);

/** ScenarioContextのDM拡張変数をsnake_caseへ変換する(JsonLogicEvaluator.evaluateManyのextraDataとして渡す)。 */
export function toScenarioExtraData(ctx: ScenarioContext): Record<string, unknown> {
  return {
    cycle_ratio: ctx.cycleRatio,
    subsc_pace_ratio: ctx.subscPaceRatio,
    days_since_homecare: ctx.daysSinceHomecare,
    csi: ctx.csi,
    is_vip: ctx.isVip,
    last_scenario_sent_days: ctx.lastScenarioSentDays,
  };
}

export interface SuppressionSpec {
  globalDays: number;
  sameScenarioDays: number;
  sameGroupDays: number;
  salesCooldownVisits: number;
  allowStageProgression: boolean;
}

/** DM候補(Candidate継承)。channel='dm'固定。 */
export interface ScenarioCandidate extends Candidate {
  channel: 'dm';
  groupCode: 'L' | 'SB' | 'R' | 'V' | 'C';
  triggerEvent: TriggerEvent;
  suppression: SuppressionSpec;
  tone: 'standard' | 'professional' | 'friendly' | 'sympathy';
  sendDelay: 'next_morning_10' | 'same_day_20' | 'plus_3d' | 'immediate_quiet_safe';
  template: string;
  templateVars: string[];
  generationMode: 'template' | 'ai_assist' | 'ai_full';
  successScore: number;
}

export interface SendHistoryItem {
  scenarioCode: string;
  groupCode: string;
  isSales: boolean;
  sentAt: ISODateTime;
  wasApproved: boolean;
  rejectCount: number;
}

/** Connector通知(同種抑止)。当日のFinalProposalSetから組み立てられる。 */
export interface InStoreShadow {
  proposalKinds: ProposalKind[]; // 当日店内winner
  manualPinActive: boolean; // O1 Pin中
}

export type ScenarioBlockReason =
  | 'idempotent'
  | 'lifecycle'
  | 'condition'
  | 'freq_7d'
  | 'same_scenario_30d'
  | 'same_group_14d'
  | 'sales_cooldown'
  | 'churn_sales_block'
  | 'reject_twice_permanent'
  | 'superseded_by_instore'
  | 'manual_pin_dm_stop'
  | 'priority_superseded'
  | 'quiet_hours';

export interface ScenarioRejectedCandidate {
  code: string;
  blockedBy: ScenarioBlockReason;
  detail?: string;
}

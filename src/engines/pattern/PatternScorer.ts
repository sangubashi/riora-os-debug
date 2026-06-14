// ================================================================
// PatternScorer (Soft層・FireScore / Success Pattern Final v1.0 §1-2)
//
// 適格候補(PatternMatcher通過後)のみを採点する。
//   FireScore = 100 × clamp01(
//       w1×SuccessRate* + w2×ContextFit + w3×TimingProximity
//     + w4×StaffAffinity + w5×Urgency
//   ) × OverrideBoost × churnPenalty
//
// 重み(w1-w5)・affinityはIParamsRepo/StaffAdjustmentEngineからの注入値を使う
// (コード定数化禁止・Brain学習の更新対象)。
// ================================================================

import type {
  AffinityResolved,
  Candidate,
  CellKey,
  CellStats,
  FeatureName,
  Overrides,
  PatternContext,
  ScoreBreakdown,
  ScoredCandidate,
  ScoringWeights,
} from '../../types/riora.types';

/** SuccessRate*のコールドスタートprior(Final v1.0 1-2)。n<10の候補が永遠に選ばれない問題を回避する。 */
const COLD_START_PRIOR = 0.5;
/** SuccessRate*にlaplace_rateをそのまま使える最小サンプル数(同上)。 */
const MIN_SAMPLE_SIZE = 10;
/** Urgency項: priorityClass→値(Final v1.0 1-2)。 */
const URGENCY_BY_PRIORITY_CLASS: Record<1 | 2 | 3 | 4, number> = { 1: 1.0, 2: 0.7, 3: 0.4, 4: 0.2 };
/** O1 Manual Pinのスコア乗数(Final v1.0 1-4)。 */
const MANUAL_PIN_BOOST = 1.5;
/** O3グレーゾーン(0.5<churn<=0.7)のchurnPenalty乗数 ×(1.4-churn)(Final v1.0 2-3ケース3)。 */
const CHURN_PENALTY_GREY_MIN = 0.5;
const CHURN_PENALTY_GREY_MAX = 0.7;
const CHURN_PENALTY_BASE = 1.4;
/** G-CHURN/O3発動時、非販売候補のUrgencyを1.0に強制する閾値(Final v1.0 1-4)。 */
const CHURN_OVERRIDE_THRESHOLD = 0.7;

/** contextFitに集約する5特徴(timing_proximityはw3で単独項に昇格済み・二重計上を避けるため除外)。 */
const CONTEXT_FIT_FEATURES: readonly FeatureName[] = [
  'cycle_position',
  'condition_margin',
  'type_confidence',
  'csi_alignment',
  'skin_momentum',
];

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * condition_margin(Hard条件の余裕度)。
 * 正典が示す2例のみ実装: subscription→subsc_conditions_met/4、非販売(churn系)→1-churn/0.7。
 * その他(homecare/upsell/pack)は正典が「例」止まりで未定義のため中立値0.5。
 */
function computeConditionMargin(candidate: Candidate, ctx: PatternContext): number {
  if (candidate.proposalKind === 'subscription') return clamp01(ctx.subscConditionsMet / 4);
  if (!candidate.isSales) return clamp01(1 - ctx.churnScore / CHURN_OVERRIDE_THRESHOLD);
  return 0.5;
}

/**
 * Soft特徴ベクトル(0-1)。
 * - timing_proximity: optimalVisit未定義時はctx.visitCountを代入(差分0=1.0、タイミング制約なしとして扱う)
 * - cycle_position: idealRatio(c)は正典未定義のため1.0(平均サイクルちょうど)を仮定
 * - type_confidence / csi_alignment / skin_momentum: ctx.rawの値をそのまま0-1としてclamp
 */
function computeFeatures(candidate: Candidate, ctx: PatternContext): Record<FeatureName, number> {
  const optimalVisit = candidate.softFeatures.optimalVisit ?? ctx.visitCount;
  const timingProximity = Math.exp(-((ctx.visitCount - optimalVisit) ** 2) / 2);

  const idealRatio = 1;
  const cyclePosition = clamp01(1 - Math.abs(ctx.raw.cycleRatio - idealRatio));

  return {
    timing_proximity: clamp01(timingProximity),
    cycle_position: cyclePosition,
    condition_margin: computeConditionMargin(candidate, ctx),
    type_confidence: clamp01(ctx.raw.typeConfidence),
    csi_alignment: clamp01(ctx.raw.csi),
    skin_momentum: clamp01(ctx.raw.skinDeltaTrend),
  };
}

/** ContextFit = Σ feature×weight / Σweight(候補定義のsoftFeatures.weightsで正規化)。重み未定義時は中立値0.5。 */
function computeContextFit(features: Record<FeatureName, number>, weights: Candidate['softFeatures']['weights']): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const name of CONTEXT_FIT_FEATURES) {
    const w = weights[name];
    if (w == null) continue;
    weightedSum += features[name] * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return COLD_START_PRIOR;
  return clamp01(weightedSum / weightTotal);
}

/** SuccessRate*: n>=10ならlaplace_rateをそのまま(0-1)、n<10はcoldstart prior=0.5。 */
function computeSuccessRate(candidate: Candidate, ctx: PatternContext, affinity: AffinityResolved, stats: ReadonlyMap<CellKey, CellStats>): number {
  const cellKey: CellKey = `${candidate.code}:${ctx.customerType}:${affinity.style}`;
  const cell = stats.get(cellKey);
  if (!cell || cell.executedN < MIN_SAMPLE_SIZE) return COLD_START_PRIOR;
  return clamp01(cell.laplaceRate);
}

/** Urgency: priorityClassマッピング。O3(churn>0.7の非販売候補)はUrgency=1.0を強制する。 */
function computeUrgency(candidate: Candidate, ctx: PatternContext): number {
  if (ctx.churnScore > CHURN_OVERRIDE_THRESHOLD && !candidate.isSales) return 1.0;
  return URGENCY_BY_PRIORITY_CLASS[candidate.priorityClass];
}

/** OverrideBoost: O1(Manual Pin)のみ×1.5。O2(店舗オーバーライド)はConflictResolver側でスコア比較を免除する(Step7)。 */
function computeOverrideBoost(candidate: Candidate, overrides: Overrides): number {
  if (overrides.manualPin?.candidateCode === candidate.code) return MANUAL_PIN_BOOST;
  return 1.0;
}

/** churnPenalty: 0.5<churn<=0.7の販売候補のみ×(1.4-churn)(グレーゾーン減衰)。 */
function computeChurnPenalty(candidate: Candidate, ctx: PatternContext): number {
  if (candidate.isSales && ctx.churnScore > CHURN_PENALTY_GREY_MIN && ctx.churnScore <= CHURN_PENALTY_GREY_MAX) {
    return CHURN_PENALTY_BASE - ctx.churnScore;
  }
  return 1.0;
}

export class PatternScorer {
  score(
    eligible: Candidate[],
    ctx: PatternContext,
    stats: ReadonlyMap<CellKey, CellStats>,
    weights: ScoringWeights,
    affinity: AffinityResolved,
    overrides: Overrides
  ): ScoredCandidate[] {
    return eligible.map((candidate) => this.scoreOne(candidate, ctx, stats, weights, affinity, overrides));
  }

  private scoreOne(
    candidate: Candidate,
    ctx: PatternContext,
    stats: ReadonlyMap<CellKey, CellStats>,
    weights: ScoringWeights,
    affinity: AffinityResolved,
    overrides: Overrides
  ): ScoredCandidate {
    const features = computeFeatures(candidate, ctx);
    const successRateRaw = computeSuccessRate(candidate, ctx, affinity, stats);
    const contextFitRaw = computeContextFit(features, candidate.softFeatures.weights);
    const affinityRaw = affinity.perKind.get(candidate.proposalKind) ?? COLD_START_PRIOR;
    const urgencyRaw = computeUrgency(candidate, ctx);
    const overrideBoost = computeOverrideBoost(candidate, overrides);
    const churnPenalty = computeChurnPenalty(candidate, ctx);

    const breakdown: ScoreBreakdown = {
      successRate: weights.w1 * successRateRaw,
      contextFit: weights.w2 * contextFitRaw,
      timing: weights.w3 * features.timing_proximity,
      affinity: weights.w4 * affinityRaw,
      urgency: weights.w5 * urgencyRaw,
      overrideBoost,
      churnPenalty,
    };

    const base = breakdown.successRate + breakdown.contextFit + breakdown.timing + breakdown.affinity + breakdown.urgency;
    const fireScore = 100 * clamp01(base) * overrideBoost * churnPenalty;

    return { candidate, features, breakdown, fireScore };
  }
}

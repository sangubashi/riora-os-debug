// ================================================================
// ConflictResolver (Pattern Engine Code Architecture v1.0 §6 /
// Success Pattern Final Architecture v1.0 §2)
//
// resolve(): Stage0(チャネル分離+店内優先のDM除外)/Stage2(排他行列)/
//   Stage3(枠詰め: 店内2件・販売1件まで)/Stage4(決定論タイブレーク)を実装する。
//   §6疑似コードは引数を`(scored, slots)`のみとするが、Stage4②(SuccessRateのn)・
//   O2(店舗オーバーライド)・出口不変条件(v2.0 §2)の評価にはctx/stats/affinity/overridesが
//   必須のため、本実装ではこれらを明示引数として受け取る(pure関数のまま・Supabase非依存)。
//
// resolveAssignment(): Final v1.0 2-3ケース1のパターン割当+切替ヒステリシス。
//   condition_margin(entry_condition)の正典定義は無いため、subsc_conditions_met/4と
//   同様の「AND節充足率」として解釈する(entryConditionの最上位andを分解して充足率を算出。
//   and以外の構造は真偽の二値0/1)。
// ================================================================

import { JsonLogicEvaluator } from './JsonLogicEvaluator';
import {
  EngineInvariantError,
  type AffinityResolved,
  type AssignmentDecision,
  type CellKey,
  type CellStats,
  type CustomerType,
  type JsonLogicRule,
  type Overrides,
  type PatternContext,
  type PatternProgress,
  type RejectedCandidate,
  type Resolution,
  type ScoredCandidate,
  type SuccessPattern,
} from '../../types/riora.types';

/** Stage3 G-FREQ精密化: 店内販売系は1件まで(Final v1.0 1-3)。inStore枠数自体はResolution型でmandatory/secondaryの2固定。 */
const DEFAULT_SLOTS = { salesMax: 1, dm: 1 } as const;

/** ケース1のヒステリシス閾値: 新パターンが現行+0.15を2回連続で上回ったら切替(Final v1.0 2-3)。 */
const SWITCH_LIFT_THRESHOLD = 0.15;
const SWITCH_STREAK_REQUIRED = 2;

/** タイプ優先順 A>C>B>D(炎症系優先の臨床的判断、Final v1.0 2-3ケース1)。Eは正典のA/B/C/D比較対象外のため暫定でAと同値。 */
const TYPE_PRIORITY_WEIGHT: Record<CustomerType, number> = {
  A_acne: 4,
  C_sensitive: 3,
  B_pore: 2,
  D_aging: 1,
  E_bridal: 4,
};

function cellKeyOf(candidate: ScoredCandidate['candidate'], ctx: PatternContext, affinity: AffinityResolved): CellKey {
  return `${candidate.code}:${ctx.customerType}:${affinity.style}`;
}

/**
 * Stage4タイブレーク(決定論固定): O2常勝 → fireScore降順 →
 * ①urgencyクラス小 ②cell.executedN大 ③version新 ④code辞書順。
 * fireScoreが同値でStage4ルールに踏み込んだ場合、onTiebreak()を呼ぶ。
 */
function compareScored(
  a: ScoredCandidate,
  b: ScoredCandidate,
  ctx: PatternContext,
  stats: ReadonlyMap<CellKey, CellStats>,
  affinity: AffinityResolved,
  overrides: Overrides,
  onTiebreak: () => void
): number {
  const aOverride = overrides.storeOverrideCodes.has(a.candidate.code);
  const bOverride = overrides.storeOverrideCodes.has(b.candidate.code);
  if (aOverride !== bOverride) return aOverride ? -1 : 1;

  if (a.fireScore !== b.fireScore) return b.fireScore - a.fireScore;

  onTiebreak();
  if (a.candidate.priorityClass !== b.candidate.priorityClass) {
    return a.candidate.priorityClass - b.candidate.priorityClass;
  }
  const aN = stats.get(cellKeyOf(a.candidate, ctx, affinity))?.executedN ?? 0;
  const bN = stats.get(cellKeyOf(b.candidate, ctx, affinity))?.executedN ?? 0;
  if (aN !== bN) return bN - aN;

  if (a.candidate.version !== b.candidate.version) return b.candidate.version - a.candidate.version;

  return a.candidate.code.localeCompare(b.candidate.code);
}

/** 出口不変条件(Proposal Generator v2.0 §2)。違反はバグ検知のためthrow(EngineInvariantError)。 */
function assertInvariants(result: Resolution, ctx: PatternContext): void {
  const selected = [result.inStore.mandatory, result.inStore.secondary].filter(
    (c): c is ScoredCandidate => c !== null
  );

  const salesCount = selected.filter((c) => c.candidate.isSales).length;
  if (salesCount > 1) {
    throw new EngineInvariantError('inStore販売系は1件以下であること', { salesCount });
  }

  for (const c of selected) {
    if (c.candidate.proposalKind === 'subscription' && ctx.subscConditionsMet !== 4) {
      throw new EngineInvariantError('subscription提案にはsubsc_conditions_met=4が必須', {
        subscConditionsMet: ctx.subscConditionsMet,
      });
    }
  }

  if (ctx.churnScore > 0.7 && selected.some((c) => c.candidate.isSales)) {
    throw new EngineInvariantError('churn_score>0.7時は販売系提案が存在してはならない', {
      churnScore: ctx.churnScore,
    });
  }

  if (
    result.inStore.mandatory &&
    result.dm &&
    result.inStore.mandatory.candidate.proposalKind === result.dm.candidate.proposalKind
  ) {
    throw new EngineInvariantError('mandatoryと同種proposalKindのdmが残存している', {
      kind: result.dm.candidate.proposalKind,
    });
  }
}

/**
 * entry_conditionの「AND節充足率」(0-1)。
 * 最上位が`and`配列ならその各要素の充足数/総数。and以外は真偽の二値0/1。
 */
function conditionMargin(evaluator: JsonLogicEvaluator, rule: JsonLogicRule, ctx: PatternContext): number {
  const andClauses = (rule as { and?: unknown }).and;
  const clauses: JsonLogicRule[] = Array.isArray(andClauses) ? (andClauses as JsonLogicRule[]) : [rule];
  if (clauses.length === 0) return 1;

  const results = evaluator.evaluateMany(
    clauses.map((c, i) => ({ key: String(i), rule: c })),
    ctx
  );
  const satisfied = clauses.filter((_, i) => results.get(String(i))?.fired === true).length;
  return satisfied / clauses.length;
}

export class ConflictResolver {
  constructor(private readonly evaluator: JsonLogicEvaluator) {}

  /**
   * Stage0(チャネル分離)/Stage2(排他行列)/Stage3(枠詰め)/Stage4(タイブレーク)。
   * Stage1(Hard gates)はPatternMatcherで完了済の前提(scoredはeligible通過済候補)。
   */
  resolve(
    scored: ScoredCandidate[],
    ctx: PatternContext,
    stats: ReadonlyMap<CellKey, CellStats>,
    affinity: AffinityResolved,
    overrides: Overrides,
    slots: { salesMax: number; dm: number } = DEFAULT_SLOTS
  ): Resolution {
    let tiebreakUsed = false;
    const markTiebreak = (): void => {
      tiebreakUsed = true;
    };
    const cmp = (a: ScoredCandidate, b: ScoredCandidate): number =>
      compareScored(a, b, ctx, stats, affinity, overrides, markTiebreak);

    const inStore = scored.filter((s) => s.candidate.channel === 'in_store').sort(cmp);
    const dm = scored.filter((s) => s.candidate.channel === 'dm').sort(cmp);

    const rejected: RejectedCandidate[] = [];

    // --- in-store: mandatory(全候補中スコア最上位) + secondary(非販売のみ・次点) ---
    const mandatory = inStore[0] ?? null;
    let secondary: ScoredCandidate | null = null;
    for (const c of inStore) {
      if (c === mandatory) continue;
      if (!c.candidate.isSales) {
        secondary = c;
        break;
      }
    }

    for (const c of inStore) {
      if (c === mandatory || c === secondary) continue;
      if (c.candidate.isSales) {
        // salesMax=1: mandatoryが既に販売系なら2件目の販売枠は構造的に存在しない('slot')。
        // mandatoryが非販売なら、この候補は#1スコア比較で敗退している('score')。
        rejected.push({
          candidate: c.candidate,
          stageReached: 3,
          blockedBy: mandatory?.candidate.isSales ? 'slot' : 'score',
          detail: `fireScore=${c.fireScore.toFixed(2)}`,
        });
      } else {
        // secondary枠(非販売1件)はすでに上位の非販売候補が占有
        rejected.push({
          candidate: c.candidate,
          stageReached: 3,
          blockedBy: 'slot',
          detail: `fireScore=${c.fireScore.toFixed(2)}`,
        });
      }
    }

    // --- dm: Stage0 同種proposal_kindの店内優先によるexclusion → 残りからslots.dm件 ---
    const inStoreKinds = new Set(
      [mandatory, secondary].filter((c): c is ScoredCandidate => c !== null).map((c) => c.candidate.proposalKind)
    );
    const dmRemaining: ScoredCandidate[] = [];
    for (const c of dm) {
      if (inStoreKinds.has(c.candidate.proposalKind)) {
        rejected.push({
          candidate: c.candidate,
          stageReached: 2,
          blockedBy: 'exclusion',
          detail: 'superseded_by_instore',
        });
      } else {
        dmRemaining.push(c);
      }
    }
    const dmWinner = dmRemaining[0] ?? null;
    for (const c of dmRemaining.slice(slots.dm)) {
      rejected.push({
        candidate: c.candidate,
        stageReached: 3,
        blockedBy: 'slot',
        detail: `fireScore=${c.fireScore.toFixed(2)}`,
      });
    }

    const result: Resolution = {
      inStore: { mandatory, secondary },
      dm: dmWinner,
      rejected,
      tiebreakUsed,
    };

    assertInvariants(result, ctx);
    return result;
  }

  /**
   * パターン割当の競合解決(Final v1.0 2-3ケース1)。
   * assignScore = conditionMargin(entry_condition) × type_confidence × タイプ別重み。
   * 初回(progress=null): entry_condition全充足(margin=1)のパターン群からassignScore最大を採用。
   * 進行中: 現行パターンのmargin(degrade可)で再計算したcurrentScoreに対し、
   *   entry_condition全充足の他パターンのassignScoreがcurrentScore+0.15を超えるかを判定。
   *   2回連続で超過、またはstalled_flag=trueなら即切替。
   */
  resolveAssignment(patterns: SuccessPattern[], ctx: PatternContext, progress: PatternProgress | null): AssignmentDecision {
    const fullyEvaluated = this.evaluator.evaluateMany(
      patterns.map((p) => ({ key: p.id, rule: p.entryCondition })),
      ctx
    );
    const eligible = patterns.filter((p) => fullyEvaluated.get(p.id)?.fired === true);
    const pool = eligible.length > 0 ? eligible : patterns;

    const scoreOf = (p: SuccessPattern): number =>
      conditionMargin(this.evaluator, p.entryCondition, ctx) * ctx.raw.typeConfidence * TYPE_PRIORITY_WEIGHT[p.customerType];

    const pickBest = (candidates: SuccessPattern[]): { pattern: SuccessPattern; score: number } | null =>
      candidates.reduce<{ pattern: SuccessPattern; score: number } | null>((acc, p) => {
        const score = scoreOf(p);
        if (!acc) return { pattern: p, score };
        if (score > acc.score) return { pattern: p, score };
        if (score === acc.score && TYPE_PRIORITY_WEIGHT[p.customerType] > TYPE_PRIORITY_WEIGHT[acc.pattern.customerType]) {
          return { pattern: p, score };
        }
        return acc;
      }, null);

    if (!progress) {
      const best = pickBest(pool);
      if (!best) {
        throw new EngineInvariantError('パターン割当候補が0件', {});
      }
      return {
        patternId: best.pattern.id,
        assignScore: best.score,
        switched: false,
        abandonedPatternId: null,
        switchCandidate: null,
        switchStreak: 0,
      };
    }

    const currentPattern = patterns.find((p) => p.id === progress.patternId);
    const currentScore = currentPattern ? scoreOf(currentPattern) : progress.assignScore ?? 0;

    const altBest = pickBest(pool.filter((p) => p.id !== progress.patternId));

    if (!altBest || altBest.score <= currentScore + SWITCH_LIFT_THRESHOLD) {
      // 揺らぎ範囲内 → 切替候補をリセット
      return {
        patternId: progress.patternId,
        assignScore: currentScore,
        switched: false,
        abandonedPatternId: null,
        switchCandidate: null,
        switchStreak: 0,
      };
    }

    if (progress.stalledFlag) {
      return {
        patternId: altBest.pattern.id,
        assignScore: altBest.score,
        switched: true,
        abandonedPatternId: progress.patternId,
        switchCandidate: null,
        switchStreak: 0,
      };
    }

    const sameCandidate = progress.switchCandidate === altBest.pattern.id;
    const nextStreak = sameCandidate ? progress.switchStreak + 1 : 1;

    if (nextStreak >= SWITCH_STREAK_REQUIRED) {
      return {
        patternId: altBest.pattern.id,
        assignScore: altBest.score,
        switched: true,
        abandonedPatternId: progress.patternId,
        switchCandidate: null,
        switchStreak: 0,
      };
    }

    return {
      patternId: progress.patternId,
      assignScore: currentScore,
      switched: false,
      abandonedPatternId: null,
      switchCandidate: altBest.pattern.id,
      switchStreak: nextStreak,
    };
  }
}

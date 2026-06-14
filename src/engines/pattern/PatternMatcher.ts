// ================================================================
// PatternMatcher (Hard層 / Pattern Engine Code Architecture v1.0 §4)
//
// 資格判定(Hard gate + Hard condition)を担当。順序固定(rejected.blockedByの
// 正確性のため):
//   0. lifecycleフィルタ: active/testing以外を除外
//      (testingはhash(customerId+code)%2による決定論的50%適用)
//   1. Hard gates: G-SUB → G-CHURN(O3) → G-COOL → G-CONSENT(dm専用)
//   2. Hard condition: evaluator.evaluateMany
// Soft特徴の生値はここでは計算しない(PatternScorerの責務)。
// G-FREQ(店内2件/販売1件まで)はConflictResolverの枠割当で処理する。
// ================================================================

import type { Candidate, MatchInput, MatchResult, OutcomeLite, ProposalKind, RejectedCandidate } from '../../types/riora.types';
import type { JsonLogicEvaluator } from './JsonLogicEvaluator';

/**
 * Pattern Engine実装設計v1 §6 CooldownController.isCoolingDown。
 * 「拒否後2来店」境界(テスト固定): 拒否visit_count=2, cooldown=2 → 3,4回目は禁止、5回目で再提案可(`<=`判定)。
 * 受諾済み・未実行はクールダウン対象外(wasExecuted && !wasAccepted のみ対象)。
 */
function isCoolingDown(kind: ProposalKind, currentVisitCount: number, outcomes: OutcomeLite[], cooldownVisits: number): boolean {
  const declined = outcomes
    .filter((o) => o.proposalKind === kind && o.wasExecuted && !o.wasAccepted)
    .sort((a, b) => b.visitCountAt - a.visitCountAt);
  const lastDeclined = declined[0];
  if (!lastDeclined) return false;
  return currentVisitCount - lastDeclined.visitCountAt <= cooldownVisits;
}

/**
 * lifecycle_status='testing'候補の決定論的50%適用判定。
 * 乱数禁止 — 同一(customerId, code)は常に同じ結果になる(hash(customerId+code) % 2 === 0)。
 */
export function isInTestingGroup(customerId: string, code: string): boolean {
  const s = `${customerId}:${code}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h & 1) === 0;
}

export class PatternMatcher {
  constructor(private readonly evaluator: JsonLogicEvaluator) {}

  match(input: MatchInput): MatchResult {
    const { candidates, ctx, recentOutcomes, consentDm } = input;
    const rejected: RejectedCandidate[] = [];
    const survivors: Candidate[] = [];

    for (const candidate of candidates) {
      // --- Stage 0: lifecycleフィルタ ---
      if (candidate.lifecycleStatus !== 'active' && candidate.lifecycleStatus !== 'testing') {
        rejected.push({
          candidate,
          stageReached: 0,
          blockedBy: 'lifecycle',
          detail: `lifecycle_status=${candidate.lifecycleStatus}`,
        });
        continue;
      }
      if (candidate.lifecycleStatus === 'testing' && !isInTestingGroup(ctx.customerId, candidate.code)) {
        rejected.push({
          candidate,
          stageReached: 0,
          blockedBy: 'lifecycle',
          detail: 'testing 50% split: control group',
        });
        continue;
      }

      // --- Stage 1: Hard gates (G-SUB -> G-CHURN -> G-COOL -> G-CONSENT) ---
      if (candidate.proposalKind === 'subscription' && ctx.subscConditionsMet < 4) {
        rejected.push({
          candidate,
          stageReached: 1,
          blockedBy: 'G-SUB',
          detail: `subsc_conditions_met=${ctx.subscConditionsMet}`,
        });
        continue;
      }
      if (ctx.churnScore > 0.7 && candidate.isSales) {
        rejected.push({
          candidate,
          stageReached: 1,
          blockedBy: 'G-CHURN',
          detail: `churn_score=${ctx.churnScore}`,
        });
        continue;
      }
      if (isCoolingDown(candidate.proposalKind, ctx.visitCount, recentOutcomes, candidate.cooldownVisits)) {
        rejected.push({
          candidate,
          stageReached: 1,
          blockedBy: 'G-COOL',
          detail: `cooldownVisits=${candidate.cooldownVisits}`,
        });
        continue;
      }
      if (candidate.channel === 'dm' && !consentDm) {
        rejected.push({ candidate, stageReached: 1, blockedBy: 'G-CONSENT' });
        continue;
      }

      survivors.push(candidate);
    }

    // --- Stage 1続き: Hard condition(一括評価) ---
    const results = this.evaluator.evaluateMany(
      survivors.map((c) => ({ key: c.uid, rule: c.hardCondition })),
      ctx
    );

    const eligible: Candidate[] = [];
    for (const candidate of survivors) {
      const r = results.get(candidate.uid);
      if (r?.fired) {
        eligible.push(candidate);
      } else {
        rejected.push({ candidate, stageReached: 1, blockedBy: 'condition', detail: r?.error });
      }
    }

    return { eligible, rejected };
  }
}

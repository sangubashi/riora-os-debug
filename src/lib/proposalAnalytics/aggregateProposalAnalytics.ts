/**
 * aggregateProposalAnalytics.ts — AI提案分析MVP(見える化のみ)の集計ロジック
 *
 * docs/AI_PROPOSAL_ANALYTICS_DASHBOARD_DESIGN.md §4.2で確定したMVP範囲
 * (表示数/実施率/施術一致率/proposal_kind内訳/月別推移/パターン別成功率)を計算する
 * 純粋関数。aggregateProposalFeedback.tsと同じ設計方針(DB非依存・PatternScorer等へは
 * 一切接続しない・見える化のみ)。
 *
 * 設計上の確定事項(§2.1・§2.2、ユーザー承認済み):
 *   - 実施率の分母はbrain_proposal_outcomes件数のみ(fire_log分母版は不採用)。
 *   - 施術一致率はwas_executedベースの現状定義(解釈A)を採用する。実施率と全く同じ
 *     計算・同じ数値になるが、将来の解釈B(メニュー突合の厳密一致)への差し替えに備えて
 *     UI上は別カードとして表示できるよう、集計結果としても独立したフィールドに分けておく。
 */
import type { BriefingEntry, OutcomeLite, PatternStepStatSummary, ProposalKind } from '../../types/riora.types';

export interface ProposalKindBreakdownRow {
  proposalKind: ProposalKind;
  count: number;
  executedCount: number;
}

export interface ProposalAnalyticsSummary {
  /** brain_pattern_fire_log件数(degraded含む、期間内の全件)。「AI提案表示数」。 */
  displayCount: number;
  /** brain_proposal_outcomes件数(実施率の分母)。 */
  outcomeCount: number;
  executedCount: number;
  /** 0-100(%)。1桁小数。outcomeCountが0の場合は0。 */
  executionRatePct: number;
  /** 現状はexecutionRatePctと同値(解釈A、MVP確定)。将来解釈Bへ差し替え可能なよう別フィールドにしている。 */
  treatmentMatchRatePct: number;
  kindBreakdown: ProposalKindBreakdownRow[];
}

export interface ProposalAnalyticsMonthlyPoint {
  /** 'YYYY-MM'形式(UTC基準の単純切り出し。月次の粗いトレンド表示のためJST変換はしない)。 */
  month: string;
  displayCount: number;
  executedCount: number;
}

export interface ProposalAnalyticsPatternRow {
  candidateCode: string;
  patternId: string;
  stepNo: number;
  customerType: string;
  staffStyle: string;
  executedN: number;
  acceptedN: number;
  /** brain_pattern_step_stats.laplace_rateを%表示に変換したもの(0-100、1桁小数)。 */
  successRatePct: number;
}

export interface ProposalAnalyticsResult {
  summary: ProposalAnalyticsSummary;
  monthlyTrend: ProposalAnalyticsMonthlyPoint[];
  patternSuccessRate: ProposalAnalyticsPatternRow[];
}

function toRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export interface AggregateProposalAnalyticsInput {
  fireLogEntries: BriefingEntry[];
  outcomes: OutcomeLite[];
  stepStats: PatternStepStatSummary[];
}

export function aggregateProposalAnalytics(input: AggregateProposalAnalyticsInput): ProposalAnalyticsResult {
  const { fireLogEntries, outcomes, stepStats } = input;

  // ─── サマリー ──────────────────────────────────────────────────────────────
  const displayCount = fireLogEntries.length;
  const outcomeCount = outcomes.length;
  const executedCount = outcomes.filter((o) => o.wasExecuted).length;
  const executionRatePct = toRate(executedCount, outcomeCount);

  const kindMap = new Map<ProposalKind, { count: number; executedCount: number }>();
  for (const o of outcomes) {
    const k = kindMap.get(o.proposalKind) ?? { count: 0, executedCount: 0 };
    k.count += 1;
    if (o.wasExecuted) k.executedCount += 1;
    kindMap.set(o.proposalKind, k);
  }
  const kindBreakdown = Array.from(kindMap.entries())
    .map(([proposalKind, v]) => ({ proposalKind, count: v.count, executedCount: v.executedCount }))
    .sort((a, b) => b.count - a.count);

  const summary: ProposalAnalyticsSummary = {
    displayCount,
    outcomeCount,
    executedCount,
    executionRatePct,
    treatmentMatchRatePct: executionRatePct,
    kindBreakdown,
  };

  // ─── 月別推移 ──────────────────────────────────────────────────────────────
  const displayByMonth = new Map<string, number>();
  for (const entry of fireLogEntries) {
    const month = monthKeyOf(entry.createdAt);
    displayByMonth.set(month, (displayByMonth.get(month) ?? 0) + 1);
  }
  const executedByMonth = new Map<string, number>();
  for (const o of outcomes) {
    if (!o.wasExecuted) continue;
    const month = monthKeyOf(o.occurredAt);
    executedByMonth.set(month, (executedByMonth.get(month) ?? 0) + 1);
  }
  const months = Array.from(
    new Set([...Array.from(displayByMonth.keys()), ...Array.from(executedByMonth.keys())])
  ).sort();
  const monthlyTrend: ProposalAnalyticsMonthlyPoint[] = months.map((month) => ({
    month,
    displayCount: displayByMonth.get(month) ?? 0,
    executedCount: executedByMonth.get(month) ?? 0,
  }));

  // ─── パターン別成功率 ──────────────────────────────────────────────────────
  const patternSuccessRate: ProposalAnalyticsPatternRow[] = stepStats
    .map((row) => ({
      candidateCode: row.candidateCode,
      patternId: row.patternId,
      stepNo: row.stepNo,
      customerType: row.customerType,
      staffStyle: row.staffStyle,
      executedN: row.executedN,
      acceptedN: row.acceptedN,
      successRatePct: Math.round(row.laplaceRate * 1000) / 10,
    }))
    .sort((a, b) => b.executedN - a.executedN);

  return { summary, monthlyTrend, patternSuccessRate };
}

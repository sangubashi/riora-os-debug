/**
 * aggregateProposalFeedback.ts — AI提案学習Phase2「見える化のみ」の集計ロジック
 *
 * brain_pattern_fire_log.decision_record.staffFeedback(good/bad)から読み取った
 * FireLogFeedbackRow[]を、提案種類別・パターン別に集計するだけの純粋関数。
 * PatternScorer/ProposalEngineへは一切接続しない(ランキング・学習には使わない)。
 */
import type { ProposalKind } from '../../types/riora.types';
import type { FireLogFeedbackRow } from '../../repositories/interfaces';

export interface ProposalKindFeedbackAggregate {
  proposalKind: ProposalKind;
  count: number;
  good: number;
  bad: number;
  /** 0-100(%)。1桁小数まで。countが0の場合は0。 */
  goodRate: number;
}

export interface PatternFeedbackAggregate {
  patternId: string;
  stepNo: number;
  proposalKind: ProposalKind;
  count: number;
  good: number;
  bad: number;
  /** 0-100(%)。1桁小数まで。countが0の場合は0。 */
  goodRate: number;
}

export interface ProposalFeedbackSummary {
  byKind: ProposalKindFeedbackAggregate[];
  byPattern: PatternFeedbackAggregate[];
}

function toRate(good: number, count: number): number {
  if (count === 0) return 0;
  return Math.round((good / count) * 1000) / 10;
}

export function aggregateProposalFeedback(rows: FireLogFeedbackRow[]): ProposalFeedbackSummary {
  const kindMap = new Map<ProposalKind, { count: number; good: number; bad: number }>();
  const patternMap = new Map<string, { patternId: string; stepNo: number; proposalKind: ProposalKind; count: number; good: number; bad: number }>();

  for (const row of rows) {
    const k = kindMap.get(row.proposalKind) ?? { count: 0, good: 0, bad: 0 };
    k.count += 1;
    if (row.feedback === 'good') k.good += 1; else k.bad += 1;
    kindMap.set(row.proposalKind, k);

    const patternKey = `${row.patternId}::${row.stepNo}`;
    const p = patternMap.get(patternKey) ?? {
      patternId: row.patternId, stepNo: row.stepNo, proposalKind: row.proposalKind, count: 0, good: 0, bad: 0,
    };
    p.count += 1;
    if (row.feedback === 'good') p.good += 1; else p.bad += 1;
    patternMap.set(patternKey, p);
  }

  const byKind = Array.from(kindMap.entries())
    .map(([proposalKind, v]) => ({ proposalKind, count: v.count, good: v.good, bad: v.bad, goodRate: toRate(v.good, v.count) }))
    .sort((a, b) => b.count - a.count);

  const byPattern = Array.from(patternMap.values())
    .map((v) => ({ ...v, goodRate: toRate(v.good, v.count) }))
    .sort((a, b) => b.count - a.count);

  return { byKind, byPattern };
}

import { describe, expect, it } from 'vitest';
import { aggregateProposalAnalytics } from '../../../src/lib/proposalAnalytics/aggregateProposalAnalytics';
import type { BriefingEntry, OutcomeLite, PatternStepStatSummary } from '../../../src/types/riora.types';

function fireLog(overrides: Partial<BriefingEntry> = {}): BriefingEntry {
  return {
    id: 'fire-1', customerId: 'cust-1', customerName: '', visitId: null,
    decisionRecord: {} as never, explanation: 'x', createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function outcome(overrides: Partial<OutcomeLite> = {}): OutcomeLite {
  return {
    patternId: 'B1', stepNo: 1, proposalKind: 'homecare', visitCountAt: 2,
    wasExecuted: false, wasAccepted: false, occurredAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function stepStat(overrides: Partial<PatternStepStatSummary> = {}): PatternStepStatSummary {
  return {
    candidateCode: 'B1-step1', patternId: 'B1', stepNo: 1, customerType: 'B_pore', staffStyle: 'theory',
    executedN: 10, acceptedN: 4, laplaceRate: 0.4, avgFireScore: null,
    ...overrides,
  };
}

describe('aggregateProposalAnalytics', () => {
  it('表示数はfire_log件数、実施率・施術一致率はoutcomes分母でwas_executed件数から計算する', () => {
    const result = aggregateProposalAnalytics({
      fireLogEntries: [fireLog(), fireLog({ id: 'fire-2' }), fireLog({ id: 'fire-3' })],
      outcomes: [
        outcome({ wasExecuted: true }),
        outcome({ wasExecuted: true }),
        outcome({ wasExecuted: false }),
        outcome({ wasExecuted: false }),
      ],
      stepStats: [],
    });

    expect(result.summary.displayCount).toBe(3);
    expect(result.summary.outcomeCount).toBe(4);
    expect(result.summary.executedCount).toBe(2);
    expect(result.summary.executionRatePct).toBe(50);
    // 施術一致率(解釈A)は実施率と完全に同じ値になる(MVP確定仕様)
    expect(result.summary.treatmentMatchRatePct).toBe(result.summary.executionRatePct);
  });

  it('outcomesが0件の場合は実施率0%(0除算しない)', () => {
    const result = aggregateProposalAnalytics({ fireLogEntries: [], outcomes: [], stepStats: [] });
    expect(result.summary.executionRatePct).toBe(0);
    expect(result.summary.treatmentMatchRatePct).toBe(0);
  });

  it('proposal_kind別内訳を件数・実施数付きで集計する', () => {
    const result = aggregateProposalAnalytics({
      fireLogEntries: [],
      outcomes: [
        outcome({ proposalKind: 'homecare', wasExecuted: true }),
        outcome({ proposalKind: 'homecare', wasExecuted: false }),
        outcome({ proposalKind: 'upsell', wasExecuted: true }),
      ],
      stepStats: [],
    });

    const byKind = new Map(result.summary.kindBreakdown.map((k) => [k.proposalKind, k]));
    expect(byKind.get('homecare')).toEqual({ proposalKind: 'homecare', count: 2, executedCount: 1 });
    expect(byKind.get('upsell')).toEqual({ proposalKind: 'upsell', count: 1, executedCount: 1 });
  });

  it('月別推移はfire_logとoutcomesの月を統合し、無い月は0で埋める', () => {
    const result = aggregateProposalAnalytics({
      fireLogEntries: [
        fireLog({ createdAt: '2026-06-15T00:00:00Z' }),
        fireLog({ createdAt: '2026-06-20T00:00:00Z' }),
        fireLog({ createdAt: '2026-07-01T00:00:00Z' }),
      ],
      outcomes: [
        outcome({ occurredAt: '2026-07-05T00:00:00Z', wasExecuted: true }),
      ],
      stepStats: [],
    });

    expect(result.monthlyTrend).toEqual([
      { month: '2026-06', displayCount: 2, executedCount: 0 },
      { month: '2026-07', displayCount: 1, executedCount: 1 },
    ]);
  });

  it('was_executed=falseのoutcomesは月別推移の実施数に含めない', () => {
    const result = aggregateProposalAnalytics({
      fireLogEntries: [fireLog('f1', '2026-07-10T00:00:00Z')],
      outcomes: [outcome({ occurredAt: '2026-07-05T00:00:00Z', wasExecuted: false })],
      stepStats: [],
    });
    expect(result.monthlyTrend).toEqual([{ month: '2026-07', displayCount: 1, executedCount: 0 }]);
  });

  it('パターン別成功率はstepStatsをexecutedN降順に並べ替え、laplaceRateを%表示に変換する', () => {
    const result = aggregateProposalAnalytics({
      fireLogEntries: [],
      outcomes: [],
      stepStats: [
        stepStat({ candidateCode: 'A1-step1', executedN: 5, laplaceRate: 0.2 }),
        stepStat({ candidateCode: 'B1-step1', executedN: 20, laplaceRate: 0.55 }),
      ],
    });

    expect(result.patternSuccessRate.map((r) => r.candidateCode)).toEqual(['B1-step1', 'A1-step1']);
    expect(result.patternSuccessRate[0].successRatePct).toBe(55);
    expect(result.patternSuccessRate[1].successRatePct).toBe(20);
  });
});

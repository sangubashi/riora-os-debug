// ================================================================
// NextActionGenerator 検証(AI提案本物化)
//
// computeCandidateDate() = lastVisitDate + round(avgCycle)(v2.0 §4基本式)。
// rebooking以外のproposalKindはnull(架空の日付を作らない)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeCandidateDate } from '../../../src/engines/pattern/NextActionGenerator';
import type { PatternContext } from '../../../src/types/riora.types';

function ctx(overrides: Partial<PatternContext> = {}): PatternContext {
  return {
    visitCount: 3, daysSinceLast: 10, avgCycle: 30, isNominationStreak2: false,
    homecarePurchasedEver: false, homecareDeclinedRecent: false, skinImproved: false,
    skinStagnant2: false, subscConditionsMet: 0, churnScore: 0, nextBookingMadeLast: false,
    weddingDaysLeft: null, retailTotal: 0,
    raw: { typeConfidence: 0.8, csi: 0.5, skinDeltaTrend: 0, cycleRatio: 1, lastVisitDate: '2026-06-01' },
    customerType: 'B_pore', customerId: 'c1', storeId: 'store-1',
    ...overrides,
  };
}

describe('computeCandidateDate', () => {
  it('proposalKind=rebookingの場合、lastVisitDate+avgCycleを返す', () => {
    expect(computeCandidateDate(ctx({ avgCycle: 28, raw: { typeConfidence: 0.8, csi: 0.5, skinDeltaTrend: 0, cycleRatio: 1, lastVisitDate: '2026-06-01' } }), 'rebooking')).toBe('2026-06-29');
  });

  it('proposalKind=rebooking以外はnull(架空の日付を作らない)', () => {
    expect(computeCandidateDate(ctx(), 'homecare')).toBeNull();
    expect(computeCandidateDate(ctx(), 'subscription')).toBeNull();
    expect(computeCandidateDate(ctx(), null)).toBeNull();
  });

  it('avgCycleが0以下の場合はnull(算出不能)', () => {
    expect(computeCandidateDate(ctx({ avgCycle: 0 }), 'rebooking')).toBeNull();
  });
});

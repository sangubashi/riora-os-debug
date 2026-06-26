// ================================================================
// ChurnRiskEngine 検証
//
// computeChurnRisk()は純粋関数(DB非依存)。来店履行履歴から平均来店間隔・
// 最終来店からの経過日数・失客リスクスコアを算出し、閾値(0.25)以上のみ
// churnRiskScore降順で返す仕様を検証する。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeChurnRisk } from '../../../src/lib/churn/ChurnRiskEngine';
import type { Customer, Visit, Staff } from '../../../src/types/riora.types';

function customer(opts: { id: string; name: string; assignedStaffId?: string | null }): Customer {
  return {
    id: opts.id, storeId: 'store-1', name: opts.name, ageGroup: null, customerType: null,
    typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
    firstVisitDate: null, assignedStaffId: opts.assignedStaffId ?? null, isSubscriber: false,
    subscribedAt: null, churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
    prefecture: null, city: null, externalKeyHash: null,
  };
}

let visitSeq = 0;
function visit(customerId: string, visitDate: string): Visit {
  visitSeq += 1;
  return {
    id: `visit-${visitSeq}`, storeId: 'store-1', customerId, staffId: 'staff-1', menuId: 'menu-1',
    visitDate, visitCountAt: 1, isNomination: false, treatmentAmount: 5000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

function staff(id: string, name: string): Staff {
  return { id, storeId: 'store-1', name, style: 'evidence', isActive: true, nameAliases: [] };
}

describe('computeChurnRisk', () => {
  it('来店が1回のみの顧客は平均来店間隔を算出できないため対象外', () => {
    const result = computeChurnRisk({
      asOfDate: '2026-06-23',
      customers: [customer({ id: 'c1', name: '新規客' })],
      visits: [visit('c1', '2026-06-01')],
      staff: [],
    });

    expect(result).toHaveLength(0);
  });

  it('来店間隔どおり(超過なし)の顧客は対象外', () => {
    // 平均間隔30日・最終来店から25日経過(cycleOverRate=0.83 < 1.5)
    const result = computeChurnRisk({
      asOfDate: '2026-06-26',
      customers: [customer({ id: 'c1', name: '順調客' })],
      visits: [visit('c1', '2026-05-02'), visit('c1', '2026-06-01')],
      staff: [],
    });

    expect(result).toHaveLength(0);
  });

  it('平均間隔の1.5倍を超えて来店が無い顧客を危険客として検出する', () => {
    // 平均間隔30日・最終来店から50日経過 → cycleOverRate=50/30=1.667 → score=(1.667-1)/2=0.333
    const result = computeChurnRisk({
      asOfDate: '2026-07-21', // 2026-06-01 + 50日
      customers: [customer({ id: 'c1', name: '危険客', assignedStaffId: 'staff-1' })],
      visits: [visit('c1', '2026-05-02'), visit('c1', '2026-06-01')],
      staff: [staff('staff-1', '鈴木')],
    });

    expect(result).toHaveLength(1);
    expect(result[0].customerId).toBe('c1');
    expect(result[0].lastVisitDate).toBe('2026-06-01');
    expect(result[0].daysSinceLastVisit).toBe(50);
    expect(result[0].avgIntervalDays).toBe(30);
    expect(result[0].churnRiskScore).toBeCloseTo((50 / 30 - 1) / 2);
    expect(result[0].assignedStaffId).toBe('staff-1');
    expect(result[0].assignedStaffName).toBe('鈴木');
  });

  it('担当スタッフ未割当の場合はassignedStaffId/Nameともnull', () => {
    const result = computeChurnRisk({
      asOfDate: '2026-07-21',
      customers: [customer({ id: 'c1', name: '危険客' })],
      visits: [visit('c1', '2026-05-02'), visit('c1', '2026-06-01')],
      staff: [],
    });

    expect(result[0].assignedStaffId).toBeNull();
    expect(result[0].assignedStaffName).toBeNull();
  });

  it('churnRiskScore降順で返す', () => {
    const result = computeChurnRisk({
      asOfDate: '2026-07-21',
      customers: [
        customer({ id: 'low', name: 'やや危険' }),
        customer({ id: 'high', name: '最も危険' }),
      ],
      visits: [
        // low: 平均間隔30日・最終来店から51日経過 → cycleOverRate=1.7 → score=0.35
        visit('low', '2026-05-01'), visit('low', '2026-05-31'),
        // high: 平均間隔20日・最終来店から50日経過 → cycleOverRate=2.5 → score=0.75
        visit('high', '2026-05-12'), visit('high', '2026-06-01'),
      ],
      staff: [],
    });

    expect(result.map((r) => r.customerId)).toEqual(['high', 'low']);
    expect(result[0].churnRiskScore).toBeCloseTo(0.75);
    expect(result[1].churnRiskScore).toBeCloseTo(0.35, 1);
  });

  it('churnRiskScoreは1を超えない(クランプ)', () => {
    // 平均間隔10日・最終来店から200日経過 → cycleOverRate=20 → (20-1)/2=9.5 → 1にクランプ
    const result = computeChurnRisk({
      asOfDate: '2026-12-18',
      customers: [customer({ id: 'c1', name: '長期離脱客' })],
      visits: [visit('c1', '2026-05-22'), visit('c1', '2026-06-01')],
      staff: [],
    });

    expect(result[0].churnRiskScore).toBe(1);
  });

  it('来店日が同日のみ(平均間隔0)の異常データはガードして対象外', () => {
    const result = computeChurnRisk({
      asOfDate: '2026-07-21',
      customers: [customer({ id: 'c1', name: '同日来店' })],
      visits: [visit('c1', '2026-06-01'), visit('c1', '2026-06-01')],
      staff: [],
    });

    expect(result).toHaveLength(0);
  });
});

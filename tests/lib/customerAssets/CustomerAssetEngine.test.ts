// ================================================================
// CustomerAssetEngine 検証
//
// computeCustomerAssets()は純粋関数(DB非依存)。来店履行履歴+継続中サブスクから
// 来店回数/最終来店日/累計売上/LTV(累計売上+MRR×6)/指名状況/来店間隔を算出し、
// LTV降順で返す仕様を検証する。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeCustomerAssets } from '../../../src/lib/customerAssets/CustomerAssetEngine';
import type { Customer, Visit, Subscription } from '../../../src/types/riora.types';

function customer(id: string, name: string): Customer {
  return {
    id, storeId: 'store-1', name, ageGroup: null, customerType: null,
    typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
    firstVisitDate: null, assignedStaffId: null, isSubscriber: false,
    subscribedAt: null, churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
    prefecture: null, city: null, externalKeyHash: null,
  };
}

let visitSeq = 0;
function visit(opts: { customerId: string; visitDate: string; treatmentAmount?: number; retailAmount?: number; isNomination?: boolean }): Visit {
  visitSeq += 1;
  return {
    id: `visit-${visitSeq}`, storeId: 'store-1', customerId: opts.customerId, staffId: 'staff-1', menuId: 'menu-1',
    visitDate: opts.visitDate, visitCountAt: 1, isNomination: opts.isNomination ?? false,
    treatmentAmount: opts.treatmentAmount ?? 10000, retailAmount: opts.retailAmount ?? 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

function subscription(opts: { customerId: string; monthlyPrice: number; cancelledAt?: string | null }): Subscription {
  return {
    id: `sub-${opts.customerId}`, storeId: 'store-1', customerId: opts.customerId, planName: 'プラン',
    monthlyPrice: opts.monthlyPrice, startedAt: '2026-01-01', cancelledAt: opts.cancelledAt ?? null, cancelReason: null,
  };
}

describe('computeCustomerAssets', () => {
  it('来店が無い顧客はvisitCount=0/lastVisitDate=totalSales=null/0・nominationRate/avgIntervalDaysはnull', () => {
    const result = computeCustomerAssets({ customers: [customer('c1', '未来店客')], visits: [], subscriptions: [] });

    expect(result).toEqual([{
      customerId: 'c1', customerName: '未来店客', visitCount: 0, lastVisitDate: null,
      totalSales: 0, ltv: 0, nominationRate: null, avgIntervalDays: null,
    }]);
  });

  it('来店回数/最終来店日/累計売上(treatment+retail)を正しく集計する', () => {
    const result = computeCustomerAssets({
      customers: [customer('c1', '田中花子')],
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-05-01', treatmentAmount: 8000, retailAmount: 2000 }),
        visit({ customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 10000, retailAmount: 0 }),
      ],
      subscriptions: [],
    });

    expect(result[0].visitCount).toBe(2);
    expect(result[0].lastVisitDate).toBe('2026-06-01');
    expect(result[0].totalSales).toBe(20000);
  });

  it('LTV = 累計売上 + 継続中サブスクのMRR×6', () => {
    const result = computeCustomerAssets({
      customers: [customer('c1', '田中花子')],
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 10000 })],
      subscriptions: [subscription({ customerId: 'c1', monthlyPrice: 8000 })],
    });

    expect(result[0].totalSales).toBe(10000);
    expect(result[0].ltv).toBe(10000 + 8000 * 6);
  });

  it('解約済みサブスク(cancelled_at設定済み)はMRVに計上しない', () => {
    const result = computeCustomerAssets({
      customers: [customer('c1', '田中花子')],
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 10000 })],
      subscriptions: [subscription({ customerId: 'c1', monthlyPrice: 8000, cancelledAt: '2026-03-01' })],
    });

    expect(result[0].ltv).toBe(10000);
  });

  it('指名状況(nominationRate)は全来店のうちis_nomination=trueの割合', () => {
    const result = computeCustomerAssets({
      customers: [customer('c1', '田中花子')],
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-05-01', isNomination: true }),
        visit({ customerId: 'c1', visitDate: '2026-06-01', isNomination: false }),
      ],
      subscriptions: [],
    });

    expect(result[0].nominationRate).toBe(0.5);
  });

  it('来店間隔(avgIntervalDays)は来店2回未満だとnull、2回以上で平均間隔(日数)', () => {
    const oneVisit = computeCustomerAssets({
      customers: [customer('c1', '新規客')],
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-01' })],
      subscriptions: [],
    });
    expect(oneVisit[0].avgIntervalDays).toBeNull();

    const twoVisits = computeCustomerAssets({
      customers: [customer('c2', '再来客')],
      visits: [
        visit({ customerId: 'c2', visitDate: '2026-05-01' }),
        visit({ customerId: 'c2', visitDate: '2026-05-21' }),
      ],
      subscriptions: [],
    });
    expect(twoVisits[0].avgIntervalDays).toBe(20);
  });

  it('LTV降順で返す', () => {
    const result = computeCustomerAssets({
      customers: [customer('low', '低LTV客'), customer('high', '高LTV客')],
      visits: [
        visit({ customerId: 'low', visitDate: '2026-06-01', treatmentAmount: 5000 }),
        visit({ customerId: 'high', visitDate: '2026-06-01', treatmentAmount: 100000 }),
      ],
      subscriptions: [],
    });

    expect(result.map((r) => r.customerId)).toEqual(['high', 'low']);
  });

  it('同一顧客に複数の継続中サブスクがある場合はMRRを合算する', () => {
    const result = computeCustomerAssets({
      customers: [customer('c1', '田中花子')],
      visits: [],
      subscriptions: [
        subscription({ customerId: 'c1', monthlyPrice: 5000 }),
        subscription({ customerId: 'c1', monthlyPrice: 3000 }),
      ],
    });

    expect(result[0].ltv).toBe((5000 + 3000) * 6);
  });
});

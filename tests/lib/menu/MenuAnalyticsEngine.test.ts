// ================================================================
// MenuAnalyticsEngine 検証
//
// computeMenuAnalytics()は純粋関数(DB非依存)。brain_menus/brain_visitsから
// 今月の件数・売上/全期間の次回予約率/直近7日間の日別売上を算出する。
// 実データソースが存在しない指標(repeatRate等)は常にnullを返す仕様を検証する。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeMenuAnalytics } from '../../../src/lib/menu/MenuAnalyticsEngine';
import type { Menu, Visit } from '../../../src/types/riora.types';

function menu(opts: { id: string; name: string; price: number }): Menu {
  return { id: opts.id, storeId: 'store-1', name: opts.name, price: opts.price, role: 'entry', targetTypes: [] };
}

let visitSeq = 0;
function visit(opts: { menuId: string; visitDate: string; treatmentAmount?: number; nextBookingMade?: boolean }): Visit {
  visitSeq += 1;
  return {
    id: `visit-${visitSeq}`, storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', menuId: opts.menuId,
    visitDate: opts.visitDate, visitCountAt: 1, isNomination: false,
    treatmentAmount: opts.treatmentAmount ?? 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false,
    nextBookingMade: opts.nextBookingMade ?? false, noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

describe('computeMenuAnalytics', () => {
  const today = new Date('2026-06-25T00:00:00Z');

  it('来店が無いメニューはmonthlyCount/monthlyRevenue=0・totalVisitCount=0・nextVisitRate=nullを返す', () => {
    const result = computeMenuAnalytics({ menus: [menu({ id: 'm1', name: 'A', price: 10000 })], visits: [], today });

    expect(result.menus).toEqual([{
      id: 'm1', name: 'A', price: 10000, role: 'entry', targetTypes: [],
      monthlyCount: 0, monthlyRevenue: 0, totalVisitCount: 0, nextVisitRate: null,
      repeatRate: null, profitMargin: null, aiRecommendRate: null, upsellSuccessRate: null, vipConversionRate: null,
    }]);
  });

  it('今月の件数・売上を月単位(visit_dateのYYYY-MM)で集計する', () => {
    const result = computeMenuAnalytics({
      menus: [menu({ id: 'm1', name: 'A', price: 10000 })],
      visits: [
        visit({ menuId: 'm1', visitDate: '2026-06-01', treatmentAmount: 8000 }),
        visit({ menuId: 'm1', visitDate: '2026-06-20', treatmentAmount: 12000 }),
        visit({ menuId: 'm1', visitDate: '2026-05-15', treatmentAmount: 9000 }), // 先月分は対象外
      ],
      today,
    });

    expect(result.menus[0].monthlyCount).toBe(2);
    expect(result.menus[0].monthlyRevenue).toBe(20000);
    expect(result.menus[0].totalVisitCount).toBe(3);
  });

  it('nextVisitRateは全期間のnext_booking_made割合(%・四捨五入)を返す', () => {
    const result = computeMenuAnalytics({
      menus: [menu({ id: 'm1', name: 'A', price: 10000 })],
      visits: [
        visit({ menuId: 'm1', visitDate: '2026-06-01', nextBookingMade: true }),
        visit({ menuId: 'm1', visitDate: '2026-06-02', nextBookingMade: true }),
        visit({ menuId: 'm1', visitDate: '2026-06-03', nextBookingMade: false }),
      ],
      today,
    });

    expect(result.menus[0].nextVisitRate).toBe(67);
  });

  it('summary.momRevenueChangePctは前月実績が0件の場合null(比較不能)', () => {
    const result = computeMenuAnalytics({
      menus: [menu({ id: 'm1', name: 'A', price: 10000 })],
      visits: [visit({ menuId: 'm1', visitDate: '2026-06-01', treatmentAmount: 10000 })],
      today,
    });

    expect(result.summary.monthlyRevenueTotal).toBe(10000);
    expect(result.summary.lastMonthRevenueTotal).toBe(0);
    expect(result.summary.momRevenueChangePct).toBeNull();
  });

  it('summary.momRevenueChangePctは今月対前月の変化率(%)を返す', () => {
    const result = computeMenuAnalytics({
      menus: [menu({ id: 'm1', name: 'A', price: 10000 })],
      visits: [
        visit({ menuId: 'm1', visitDate: '2026-06-01', treatmentAmount: 12000 }),
        visit({ menuId: 'm1', visitDate: '2026-05-01', treatmentAmount: 10000 }),
      ],
      today,
    });

    expect(result.summary.momRevenueChangePct).toBe(20);
  });

  it('summary.dailyRevenueLast7Daysは基準日を含む直近7日分を古い日付順で返す', () => {
    const result = computeMenuAnalytics({
      menus: [menu({ id: 'm1', name: 'A', price: 10000 })],
      visits: [visit({ menuId: 'm1', visitDate: '2026-06-25', treatmentAmount: 5000 })],
      today,
    });

    expect(result.summary.dailyRevenueLast7Days).toHaveLength(7);
    expect(result.summary.dailyRevenueLast7Days[6]).toEqual({ date: '2026-06-25', revenue: 5000 });
    expect(result.summary.dailyRevenueLast7Days[0].date).toBe('2026-06-19');
  });
});

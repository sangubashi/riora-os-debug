// ================================================================
// StaffAnalyticsEngine 検証
//
// computeStaffAnalytics()は純粋関数(DB非依存)。担当来店履行歴から当月売上/
// 店販売上/指名率/リピート率/客単価/成長率を算出し、五十音順(近似)で返す仕様を検証する。
// ランキング・順位フィールドを一切持たないことも確認する。
// computeStaffAnalyticsTotal()は全スタッフ合算(合計行・PHASE STAFFANALYTICS-TOTAL)を検証する。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeStaffAnalytics, computeStaffAnalyticsTotal } from '../../../src/lib/staffAnalytics/StaffAnalyticsEngine';
import type { Staff, Visit } from '../../../src/types/riora.types';

function staff(id: string, name: string): Staff {
  return { id, storeId: 'store-1', name, style: 'evidence', isActive: true, nameAliases: [] };
}

let visitSeq = 0;
function visit(opts: {
  staffId: string; customerId: string; visitDate: string;
  treatmentAmount?: number; retailAmount?: number; isNomination?: boolean; visitCountAt?: number;
}): Visit {
  visitSeq += 1;
  return {
    id: `visit-${visitSeq}`, storeId: 'store-1', customerId: opts.customerId, staffId: opts.staffId, menuId: 'menu-1',
    visitDate: opts.visitDate, visitCountAt: opts.visitCountAt ?? 1, isNomination: opts.isNomination ?? false,
    treatmentAmount: opts.treatmentAmount ?? 10000, retailAmount: opts.retailAmount ?? 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0,
  };
}

describe('computeStaffAnalytics', () => {
  it('担当来店が無いスタッフはmonthlySales/retailSales=0・nominationRate/repeatRate/growthRateはnull', () => {
    const result = computeStaffAnalytics({
      asOfDate: '2026-06-23', staff: [staff('s1', '鈴木')], visits: [],
    });

    expect(result).toEqual([{
      staffId: 's1', staffName: '鈴木', monthlySales: 0, retailSales: 0, visitCount: 0, avgSpend: null,
      nominationRate: null, repeatRate: null, growthRate: null,
    }]);
  });

  it('当月売上(monthlySales)は担当来店のうち当月分のtreatment+retail合計、店販売上(retailSales)はretail合計のみ', () => {
    const result = computeStaffAnalytics({
      asOfDate: '2026-06-23',
      staff: [staff('s1', '鈴木')],
      visits: [
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-05-30', treatmentAmount: 99999 }), // 前月: 除外
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 8000, retailAmount: 2000 }),
        visit({ staffId: 's2', customerId: 'c1', visitDate: '2026-06-05', treatmentAmount: 99999 }), // 他スタッフ: 除外
      ],
    });

    expect(result[0].monthlySales).toBe(10000);
    expect(result[0].retailSales).toBe(2000);
  });

  it('指名率・リピート率は担当来店全履歴(月をまたいで集計)から算出する', () => {
    const result = computeStaffAnalytics({
      asOfDate: '2026-06-23',
      staff: [staff('s1', '鈴木')],
      visits: [
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-05-01', isNomination: true, visitCountAt: 1 }),
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-06-01', isNomination: false, visitCountAt: 2 }),
      ],
    });

    expect(result[0].nominationRate).toBe(0.5);
    expect(result[0].repeatRate).toBe(0.5); // visitCountAt>1が1件/2件
  });

  it('成長率は(当月売上-前月売上)/前月売上。前月売上0(または前月データ無し)はnull', () => {
    const withGrowth = computeStaffAnalytics({
      asOfDate: '2026-06-23',
      staff: [staff('s1', '鈴木')],
      visits: [
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-05-10', treatmentAmount: 10000 }),
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 15000 }),
      ],
    });
    expect(withGrowth[0].growthRate).toBeCloseTo((15000 - 10000) / 10000);

    const noPriorMonth = computeStaffAnalytics({
      asOfDate: '2026-06-23',
      staff: [staff('s1', '鈴木')],
      visits: [visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-06-10', treatmentAmount: 15000 })],
    });
    expect(noPriorMonth[0].growthRate).toBeNull();
  });

  it('年をまたぐ前月計算(1月の前月は前年12月)が正しい', () => {
    const result = computeStaffAnalytics({
      asOfDate: '2027-01-15',
      staff: [staff('s1', '鈴木')],
      visits: [
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-12-20', treatmentAmount: 10000 }),
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2027-01-05', treatmentAmount: 12000 }),
      ],
    });

    expect(result[0].growthRate).toBeCloseTo((12000 - 10000) / 10000);
  });

  it('入力順や売上の高さに関わらず、固定順(鈴木→亀山→外舘→久保田)で安定して返す', () => {
    const expectedOrder = ['鈴木', '亀山', '外舘'];

    const result = computeStaffAnalytics({
      asOfDate: '2026-06-23',
      staff: [staff('s-suzuki', '鈴木'), staff('s-kameyama', '亀山'), staff('s-todate', '外舘')],
      visits: [
        // 売上が最も高いスタッフでも、売上順に並び替わらないことを確認(ランキング禁止)
        visit({ staffId: 's-todate', customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 999999 }),
      ],
    });

    expect(result.map((r) => r.staffName)).toEqual(expectedOrder);
    result.forEach((r) => {
      expect(r).not.toHaveProperty('rank');
      expect(r).not.toHaveProperty('ranking');
    });
  });
});

describe('computeStaffAnalyticsTotal', () => {
  it('担当スタッフで絞り込まずvisits全件を集計し、全スタッフ合算の売上/店販売上を返す', () => {
    const result = computeStaffAnalyticsTotal({
      asOfDate: '2026-06-23',
      staff: [staff('s1', '鈴木'), staff('s2', '亀山')],
      visits: [
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-06-01', treatmentAmount: 8000, retailAmount: 2000 }),
        visit({ staffId: 's2', customerId: 'c2', visitDate: '2026-06-05', treatmentAmount: 10000, retailAmount: 1000 }),
      ],
    });

    expect(result.monthlySales).toBe(21000);
    expect(result.retailSales).toBe(3000);
    expect(result.visitCount).toBe(2);
    expect(result.avgSpend).toBe(10500);
  });

  it('指名率・リピート率は単純平均ではなく全件ベースの加重値になる', () => {
    const result = computeStaffAnalyticsTotal({
      asOfDate: '2026-06-23',
      staff: [staff('s1', '鈴木'), staff('s2', '亀山')],
      visits: [
        // s1: 3件中3件が指名(指名率100%)
        visit({ staffId: 's1', customerId: 'c1', visitDate: '2026-06-01', isNomination: true }),
        visit({ staffId: 's1', customerId: 'c2', visitDate: '2026-06-02', isNomination: true }),
        visit({ staffId: 's1', customerId: 'c3', visitDate: '2026-06-03', isNomination: true }),
        // s2: 1件中0件が指名(指名率0%)
        visit({ staffId: 's2', customerId: 'c4', visitDate: '2026-06-04', isNomination: false }),
      ],
    });

    // 単純平均(100%+0%)/2=50%ではなく、全4件中3件=75%になる
    expect(result.nominationRate).toBe(0.75);
  });

  it('visitsが空の場合は全項目null/0', () => {
    const result = computeStaffAnalyticsTotal({
      asOfDate: '2026-06-23', staff: [staff('s1', '鈴木')], visits: [],
    });

    expect(result).toEqual({
      monthlySales: 0, retailSales: 0, visitCount: 0, avgSpend: null,
      nominationRate: null, repeatRate: null, growthRate: null,
    });
  });
});

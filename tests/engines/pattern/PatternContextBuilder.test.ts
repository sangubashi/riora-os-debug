// ================================================================
// PatternContextBuilder 検証(AI提案本物化)
//
// buildPatternContext()は純粋関数(DB非依存)。ContextBundle(実データ)から
// PatternContextを構築する。実データソースが無い特徴量(CSI等)は中立値、
// 必須データ(customerType/来店履歴)が無い場合はok:falseを返す
// (モックデータで埋めない)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { buildPatternContext } from '../../../src/engines/pattern/PatternContextBuilder';
import type { Customer, Visit, ContextBundle, Staff, SkinRecord } from '../../../src/types/riora.types';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1', storeId: 'store-1', name: '田中花子', ageGroup: null, customerType: 'B_pore',
    typeConfidence: 0.8, goalNote: null, weddingDate: null, acquisitionChannel: null,
    firstVisitDate: '2026-01-01', assignedStaffId: null, isSubscriber: false, subscribedAt: null,
    churnScore: 0, churnReason: null, consentAnonymizedLearning: false, prefecture: null, city: null,
    externalKeyHash: null, ...overrides,
  };
}

let visitSeq = 0;
function visit(overrides: Partial<Visit> = {}): Visit {
  visitSeq += 1;
  return {
    id: `v${visitSeq}`, storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', menuId: 'menu-1',
    visitDate: '2026-06-01', visitCountAt: 1, isNomination: false, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0, ...overrides,
  };
}

function staff(): Staff {
  return { id: 'staff-1', storeId: 'store-1', name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] };
}

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    customer: customer(), visits: [visit()], skinRecords: [], progress: null, subscription: null,
    recentOutcomes: [], staff: staff(), todaysBookings: [], nowJst: '2026-06-25T10:00:00+09:00',
    ...overrides,
  };
}

describe('buildPatternContext', () => {
  it('customerTypeが未設定の場合はno_customer_typeで失敗する(架空の型を割り当てない)', () => {
    const result = buildPatternContext(bundle({ customer: customer({ customerType: null }) }), '2026-06-25');
    expect(result).toEqual({ ok: false, reason: 'no_customer_type' });
  });

  it('来店履歴が0件の場合はno_visit_historyで失敗する', () => {
    const result = buildPatternContext(bundle({ visits: [] }), '2026-06-25');
    expect(result).toEqual({ ok: false, reason: 'no_visit_history' });
  });

  it('来店1件のみの場合、avgCycleは30日固定(架空の周期を作らないための中立値)', () => {
    const result = buildPatternContext(bundle({ visits: [visit({ visitDate: '2026-06-01' })] }), '2026-06-25');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.visitCount).toBe(1);
      expect(result.context.avgCycle).toBe(30);
    }
  });

  it('来店2回以上の場合、平均来店間隔を実データから算出する', () => {
    const result = buildPatternContext(bundle({
      visits: [visit({ visitDate: '2026-05-01' }), visit({ visitDate: '2026-05-31' })],
    }), '2026-06-25');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.avgCycle).toBe(30);
      expect(result.context.daysSinceLast).toBe(25); // 05-31から06-25まで
    }
  });

  it('直近2回が連続指名の場合、isNominationStreak2=true', () => {
    const result = buildPatternContext(bundle({
      visits: [visit({ visitDate: '2026-05-01', isNomination: true }), visit({ visitDate: '2026-05-31', isNomination: true })],
    }), '2026-06-25');
    expect(result.ok && result.context.isNominationStreak2).toBe(true);
  });

  it('ホームケア購入歴・店販購入歴がある場合、subscConditionsMetに反映する(本ファイルで定義した4指標)', () => {
    const result = buildPatternContext(bundle({
      visits: [
        visit({ visitDate: '2026-04-01', homecarePurchased: true }),
        visit({ visitDate: '2026-05-01' }),
        visit({ visitDate: '2026-06-01', retailAmount: 3000 }),
      ],
    }), '2026-06-25');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // ①visitCount>=3 ②homecarePurchasedEver ④retailTotal>0 の3条件(③連続指名は無し)
      expect(result.context.subscConditionsMet).toBe(3);
    }
  });

  it('CSIの実データソースが無いため中立値0.5を返す(架空の評価値を作らない)', () => {
    const result = buildPatternContext(bundle(), '2026-06-25');
    expect(result.ok && result.context.raw.csi).toBe(0.5);
  });

  it('skinRecordsが空の場合、skinImproved/skinStagnant2はfalse(架空の改善を作らない)', () => {
    const result = buildPatternContext(bundle({ skinRecords: [] }), '2026-06-25');
    expect(result.ok && result.context.skinImproved).toBe(false);
    expect(result.ok && result.context.skinStagnant2).toBe(false);
  });

  it('skinRecordsの直近2件のprimaryDeltaが正の場合、skinImproved=true', () => {
    const skinRecords: SkinRecord[] = [
      { id: 's1', customerId: 'c1', visitId: 'v1', acneLevel: null, poreLevel: null, drynessLevel: null, rednessLevel: null, saggingLevel: null, dullnessLevel: null, firmnessLevel: null, primaryDelta: 2 },
      { id: 's2', customerId: 'c1', visitId: 'v2', acneLevel: null, poreLevel: null, drynessLevel: null, rednessLevel: null, saggingLevel: null, dullnessLevel: null, firmnessLevel: null, primaryDelta: 3 },
    ];
    const result = buildPatternContext(bundle({ skinRecords }), '2026-06-25');
    expect(result.ok && result.context.skinImproved).toBe(true);
  });

  it('weddingDateが設定されている場合、weddingDaysLeftを実日数で算出する', () => {
    const result = buildPatternContext(bundle({ customer: customer({ weddingDate: '2026-07-25' }) }), '2026-06-25');
    expect(result.ok && result.context.weddingDaysLeft).toBe(30);
  });

  it('weddingDateが未設定の場合、weddingDaysLeftはnull', () => {
    const result = buildPatternContext(bundle(), '2026-06-25');
    expect(result.ok && result.context.weddingDaysLeft).toBeNull();
  });
});

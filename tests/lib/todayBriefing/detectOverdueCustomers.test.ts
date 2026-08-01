// ================================================================
// detectOverdueCustomers 検証
//
// 「今日のブリーフィング」担当顧客ロスター向けルール(再来推奨日超過・来店45日
// 以上・店販60日以上)を純粋関数として検証する。ルールベースのみ・LLM不使用。
// ================================================================
import { describe, expect, it } from 'vitest';
import { evaluateOverdueCustomer, countOverdueCustomers, type RosterCustomerInput } from '../../../src/lib/todayBriefing/detectOverdueCustomers';

// customer側の日付(visit_date等)と同じ「日付のみ文字列(UTC解釈)」でTODAYも構築する。
// startOfDay()はlocalのgetFullYear/getMonth/getDateを使うため、TODAY側だけ
// 別方式(タイムゾーン付き・ローカル解釈)で構築するとホストのタイムゾーンによって
// 日数差がずれるおそれがある。両辺を同じ解釈方式に揃えることでテストを決定論的にする。
const TODAY = new Date('2026-08-01');

function customer(overrides: Partial<RosterCustomerInput> = {}): RosterCustomerInput {
  return {
    id: 'c1', lastVisitDate: null, lastRetailPurchaseDate: null, recommendedCycleDays: null,
    ...overrides,
  };
}

describe('evaluateOverdueCustomer', () => {
  it('recommended_cycle_daysを超えた場合のみ再来推奨に該当する', () => {
    // 30日サイクル・前回来店から31日経過 → 該当
    const overdue = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-07-01', recommendedCycleDays: 30 }), TODAY);
    expect(overdue.recommendedRevisit).toBe(true);

    // 30日サイクル・前回来店からちょうど30日 → 「過ぎた」ではないため非該当
    const onCycle = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-07-02', recommendedCycleDays: 30 }), TODAY);
    expect(onCycle.recommendedRevisit).toBe(false);
  });

  it('recommended_cycle_daysが未設定(null・0以下)の場合は再来推奨の対象外', () => {
    const noCycle = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-01-01', recommendedCycleDays: null }), TODAY);
    expect(noCycle.recommendedRevisit).toBe(false);

    const zeroCycle = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-01-01', recommendedCycleDays: 0 }), TODAY);
    expect(zeroCycle.recommendedRevisit).toBe(false);
  });

  it('前回来店から45日以上経過で該当する(recommended_cycle_daysが未設定の場合のみ)', () => {
    const d44 = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-06-18' }), TODAY); // 44日
    expect(d44.staleVisit).toBe(false);

    const d45 = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-06-17' }), TODAY); // 45日
    expect(d45.staleVisit).toBe(true);
  });

  it('①再来推奨と②来店45日は排他(同じ顧客で二重通知しない・ユーザー指摘2026-08-01)', () => {
    // 推奨サイクル35日・前回来店50日経過 → 「再来推奨日超過」のみ該当し、
    // 「来店45日以上」は該当しない(スタッフに同じ内容を2回伝えない)。
    const result = evaluateOverdueCustomer(
      customer({ lastVisitDate: '2026-06-12', recommendedCycleDays: 35 }), // 50日経過
      TODAY
    );
    expect(result.recommendedRevisit).toBe(true);
    expect(result.staleVisit).toBe(false);

    // recommended_cycle_days未設定の顧客が50日経過している場合は、②のみ該当する。
    const noCycleResult = evaluateOverdueCustomer(customer({ lastVisitDate: '2026-06-12' }), TODAY);
    expect(noCycleResult.recommendedRevisit).toBe(false);
    expect(noCycleResult.staleVisit).toBe(true);
  });

  it('店販購入から60日以上経過で該当する。購入履歴が無い場合は対象外', () => {
    const d59 = evaluateOverdueCustomer(customer({ lastRetailPurchaseDate: '2026-06-03' }), TODAY); // 59日
    expect(d59.retailReplenish).toBe(false);

    const d60 = evaluateOverdueCustomer(customer({ lastRetailPurchaseDate: '2026-06-02' }), TODAY); // 60日
    expect(d60.retailReplenish).toBe(true);

    const none = evaluateOverdueCustomer(customer({ lastRetailPurchaseDate: null }), TODAY);
    expect(none.retailReplenish).toBe(false);
  });

  it('来店記録が無い顧客は再来推奨・来店45日いずれも対象外(架空の経過日数を作らない)', () => {
    const result = evaluateOverdueCustomer(customer({ lastVisitDate: null, recommendedCycleDays: 30 }), TODAY);
    expect(result.recommendedRevisit).toBe(false);
    expect(result.staleVisit).toBe(false);
  });
});

describe('countOverdueCustomers', () => {
  it('recommended_cycle_days設定済みの顧客は再来推奨のみに計上され、来店45日には二重計上しない', () => {
    const customers: RosterCustomerInput[] = [
      // recommendedCycleDays超過(92日経過・20日サイクル) → 再来推奨のみ
      customer({ id: 'c1', lastVisitDate: '2026-05-01', recommendedCycleDays: 20 }),
      // recommendedCycleDays未設定・50日経過 → 来店45日のみ
      customer({ id: 'c2', lastVisitDate: '2026-06-12' }),
      // どちらにも該当しない(12日)
      customer({ id: 'c3', lastVisitDate: '2026-07-20' }),
    ];

    const result = countOverdueCustomers(customers, TODAY);
    expect(result.recommendedRevisitCount).toBe(1);
    expect(result.staleVisitCount).toBe(1);
    expect(result.retailReplenishCount).toBe(0);
    expect(result.recommendedRevisitIds).toEqual(['c1']);
    expect(result.staleVisitIds).toEqual(['c2']);
    expect(result.retailReplenishIds).toEqual([]);
  });

  it('該当者が居ない場合は全項目0・id一覧も空配列', () => {
    const result = countOverdueCustomers([customer({ lastVisitDate: '2026-07-30' })], TODAY);
    expect(result).toEqual({
      recommendedRevisitCount: 0, staleVisitCount: 0, retailReplenishCount: 0,
      recommendedRevisitIds: [], staleVisitIds: [], retailReplenishIds: [],
    });
  });
});

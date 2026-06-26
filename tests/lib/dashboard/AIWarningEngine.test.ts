// ================================================================
// AIWarningEngine 検証(画面①経営TOP「今日の一手」AI Warning)
//
// computeAIWarnings()は純粋関数(DB非依存・決定論ルール・LLM不使用)。
// 各ルールは実データの条件が成立しない限りnull(警告を生成しない)。
// モックデータ・固定文言で埋めることは禁止のため、データが無い場合は
// 配列が空になることを正としてテストする。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeAIWarnings } from '../../../src/lib/dashboard/AIWarningEngine';
import type { Customer, Visit, Staff, Subscription } from '../../../src/types/riora.types';

function customer(id: string, name: string, assignedStaffId: string | null = null): Customer {
  return {
    id, storeId: 'store-1', name, ageGroup: null, customerType: null, typeConfidence: 0,
    goalNote: null, weddingDate: null, acquisitionChannel: null, firstVisitDate: null,
    assignedStaffId, isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
    consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
  };
}

let visitSeq = 0;
function visit(opts: { customerId: string; visitDate: string; treatmentAmount?: number; isNomination?: boolean }): Visit {
  visitSeq += 1;
  return {
    id: `visit-${visitSeq}`, storeId: 'store-1', customerId: opts.customerId, staffId: 'staff-1', menuId: 'menu-1',
    visitDate: opts.visitDate, visitCountAt: 1, isNomination: opts.isNomination ?? false,
    treatmentAmount: opts.treatmentAmount ?? 10000, retailAmount: 0, retailCategory: null,
    homecarePurchased: false, homecareDeclined: false, nextBookingMade: false, noBookingReason: null,
    voiceMemoUrl: null, visitScore: 0,
  };
}

function staffMember(id: string, name: string): Staff {
  return { id, storeId: 'store-1', name, style: 'evidence', isActive: true, nameAliases: [] };
}

function subscription(opts: { customerId: string; startedAt: string; cancelledAt?: string | null }): Subscription {
  return {
    id: `sub-${opts.customerId}`, storeId: 'store-1', customerId: opts.customerId, planName: 'プラン',
    monthlyPrice: 10000, startedAt: opts.startedAt, cancelledAt: opts.cancelledAt ?? null, cancelReason: null,
  };
}

const BASE_INPUT = {
  asOfDate: '2026-06-25',
  customers: [] as Customer[],
  visits: [] as Visit[],
  staff: [] as Staff[],
  subscriptions: [] as Subscription[],
  monthlyVisitCount: 0,
  currentRepeat30: null,
  previousRepeat30: null,
  currentNominationRate: null,
  previousNominationRate: null,
};

describe('computeAIWarnings', () => {
  it('実データが何もない場合は空配列を返す(モックで埋めない)', () => {
    expect(computeAIWarnings(BASE_INPUT)).toEqual([]);
  });

  it('失客予兆: 来店周期を1.5倍以上超過した顧客がいる場合に生成する(ChurnRiskEngine準拠)', () => {
    const result = computeAIWarnings({
      ...BASE_INPUT,
      customers: [customer('c1', '田中花子', 'staff-1')],
      staff: [staffMember('staff-1', '鈴木')],
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-01-01' }),
        visit({ customerId: 'c1', visitDate: '2026-02-01' }), // 平均間隔31日
        // 最終来店から見て1.5倍(約46.5日)を大きく超過させるため基準日を遠ざける
      ],
      asOfDate: '2026-06-25',
    });

    const churnInsight = result.find((r) => r.title === '失客予兆');
    expect(churnInsight).toMatchObject({ severity: 'critical', targetCount: 1, actionType: 'contact_customer' });
    expect(churnInsight?.message).toContain('田中花子');
    expect(churnInsight?.message).toContain('鈴木');
  });

  it('リピート率低下: 前月比10%以上の低下がある場合に生成する(10%未満はノイズとして無視)', () => {
    const declined = computeAIWarnings({ ...BASE_INPUT, monthlyVisitCount: 20, currentRepeat30: 0.4, previousRepeat30: 0.6 });
    expect(declined.find((r) => r.title === 'リピート率低下')).toMatchObject({ severity: 'warning', targetCount: 20, actionType: 'review_staff' });

    const noisy = computeAIWarnings({ ...BASE_INPUT, currentRepeat30: 0.58, previousRepeat30: 0.6 });
    expect(noisy.find((r) => r.title === 'リピート率低下')).toBeUndefined();
  });

  it('リピート率低下: 前月データが無い場合はnull(比較基準が無いため判定しない)', () => {
    const result = computeAIWarnings({ ...BASE_INPUT, currentRepeat30: 0.3, previousRepeat30: null });
    expect(result.find((r) => r.title === 'リピート率低下')).toBeUndefined();
  });

  it('指名率低下: 前月比10%以上の低下がある場合に生成する', () => {
    const result = computeAIWarnings({ ...BASE_INPUT, monthlyVisitCount: 15, currentNominationRate: 0.3, previousNominationRate: 0.5 });
    expect(result.find((r) => r.title === '指名率低下')).toMatchObject({ severity: 'warning', targetCount: 15, actionType: 'review_staff' });
  });

  it('来店周期超過: 1.0〜1.5倍の早期段階の顧客を検出する(1.5倍以上は失客予兆で別途扱う)', () => {
    // 平均間隔30日・最終来店から33日経過 = cycleOverRate 1.1倍(早期段階)
    const result = computeAIWarnings({
      ...BASE_INPUT,
      customers: [customer('c1', '佐藤太郎')],
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-05-01' }),
        visit({ customerId: 'c1', visitDate: '2026-05-31' }),
      ],
      asOfDate: '2026-07-03', // 2026-05-31から33日後
    });

    const cycleInsight = result.find((r) => r.title === '来店周期超過');
    expect(cycleInsight).toMatchObject({ severity: 'warning', targetCount: 1, actionType: 'send_line' });
    // 失客予兆(1.5倍以上)はまだ発生しない
    expect(result.find((r) => r.title === '失客予兆')).toBeUndefined();
  });

  it('VIP来店停滞: LTV上位20%の顧客が来店周期を超えている場合に生成する', () => {
    // c1は他より圧倒的に高額来店歴を持つ唯一の顧客=top20%(VIP)。来店周期も超過させる。
    const customers = [customer('c1', '高額顧客'), customer('c2', '一般客A'), customer('c3', '一般客B'), customer('c4', '一般客C'), customer('c5', '一般客D')];
    const visits = [
      visit({ customerId: 'c1', visitDate: '2026-01-01', treatmentAmount: 100000 }),
      visit({ customerId: 'c1', visitDate: '2026-02-01', treatmentAmount: 100000 }),
      visit({ customerId: 'c2', visitDate: '2026-06-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c3', visitDate: '2026-06-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c4', visitDate: '2026-06-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c5', visitDate: '2026-06-01', treatmentAmount: 5000 }),
    ];
    const result = computeAIWarnings({ ...BASE_INPUT, customers, visits, asOfDate: '2026-06-25' });

    expect(result.find((r) => r.title === 'VIP来店停滞')).toMatchObject({ severity: 'critical', actionType: 'contact_customer' });
  });

  it('高単価顧客離脱予兆: 客単価上位20%の顧客が来店周期を超えている場合に生成する', () => {
    const customers = [customer('c1', '高単価客'), customer('c2', '通常客A'), customer('c3', '通常客B'), customer('c4', '通常客C'), customer('c5', '通常客D')];
    const visits = [
      visit({ customerId: 'c1', visitDate: '2026-01-01', treatmentAmount: 80000 }),
      visit({ customerId: 'c1', visitDate: '2026-02-01', treatmentAmount: 80000 }),
      visit({ customerId: 'c2', visitDate: '2026-01-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c2', visitDate: '2026-06-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c3', visitDate: '2026-06-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c4', visitDate: '2026-06-01', treatmentAmount: 5000 }),
      visit({ customerId: 'c5', visitDate: '2026-06-01', treatmentAmount: 5000 }),
    ];
    const result = computeAIWarnings({ ...BASE_INPUT, customers, visits, asOfDate: '2026-06-25' });

    expect(result.find((r) => r.title === '高単価顧客離脱予兆')).toMatchObject({ severity: 'critical', actionType: 'contact_customer' });
  });

  it('サブスク更新接近: 継続中サブスクの請求日(started_atの日)が7日以内の場合に生成する', () => {
    const result = computeAIWarnings({
      ...BASE_INPUT,
      customers: [customer('c1', 'サブスク客')],
      subscriptions: [subscription({ customerId: 'c1', startedAt: '2026-01-28' })], // 毎月28日請求
      asOfDate: '2026-06-25', // 28日まで3日
    });

    expect(result.find((r) => r.title === 'サブスク更新接近')).toMatchObject({ severity: 'info', targetCount: 1, actionType: 'upsell_campaign' });
  });

  it('サブスク更新接近: 解約済み(cancelledAt設定済み)のサブスクは対象外', () => {
    const result = computeAIWarnings({
      ...BASE_INPUT,
      customers: [customer('c1', '解約客')],
      subscriptions: [subscription({ customerId: 'c1', startedAt: '2026-01-28', cancelledAt: '2026-03-01' })],
      asOfDate: '2026-06-25',
    });
    expect(result.find((r) => r.title === 'サブスク更新接近')).toBeUndefined();
  });

  it('DM反応率低下: 実データソースが無いため恒久的に生成されない', () => {
    // brain_line_send_queueに反応(開封/予約転換)を記録する列が存在しないため、
    // どのような入力を与えても本ルールは発火しない(モックで埋めない方針)。
    const result = computeAIWarnings({
      ...BASE_INPUT,
      customers: [customer('c1', '田中花子')],
      visits: [visit({ customerId: 'c1', visitDate: '2026-06-01' })],
    });
    expect(result.find((r) => r.title === 'DM反応率低下')).toBeUndefined();
  });

  it('複数ルールが同時成立する場合、優先順位(失客予兆→VIP→DM→リピート→指名→周期→高単価→サブスク)どおりの順序で返す', () => {
    const PRIORITY_ORDER = ['失客予兆', 'VIP来店停滞', 'DM反応率低下', 'リピート率低下', '指名率低下', '来店周期超過', '高単価顧客離脱予兆', 'サブスク更新接近'];

    const result = computeAIWarnings({
      asOfDate: '2026-06-25',
      customers: [customer('c1', '田中花子', 'staff-1')],
      staff: [staffMember('staff-1', '鈴木')],
      visits: [
        visit({ customerId: 'c1', visitDate: '2026-01-01' }),
        visit({ customerId: 'c1', visitDate: '2026-02-01' }),
      ],
      subscriptions: [subscription({ customerId: 'c1', startedAt: '2026-06-28' })],
      monthlyVisitCount: 10,
      currentRepeat30: 0.3,
      previousRepeat30: 0.6,
      currentNominationRate: 0.2,
      previousNominationRate: 0.5,
    });

    // この単一顧客フィクスチャでは失客予兆・VIP来店停滞・高単価顧客離脱予兆が同時成立しうる
    // (唯一の顧客は自動的にLTV/客単価いずれも「上位20%」になるため)。テストの主目的は
    // 「実際に発火した警告が優先順位どおりに並んでいること」の検証であり、毎回必ず発火する
    // 項目を固定列挙することではない。
    expect(result.length).toBeGreaterThan(0);
    const indices = result.map((r) => PRIORITY_ORDER.indexOf(r.title));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(result.map((r) => r.title)).toContain('失客予兆');
    expect(result.map((r) => r.title)).toContain('リピート率低下');
    expect(result.map((r) => r.title)).toContain('指名率低下');
    expect(result.map((r) => r.title)).toContain('サブスク更新接近');
  });
});

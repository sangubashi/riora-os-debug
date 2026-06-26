// ================================================================
// customerMatcher 検証(Pass D: 顧客名寄せ精度検証)
//
// 設計方針(CSVImportSecurityArchitecture.md §3-3): 氏名一致のみでは自動マージしない
// (同姓同名の別人を誤って統合するリスクがあるため)。本テストはこの「確認待ち」方針が
// 維持されていることを確認する。実際の重複顧客リスク(会員番号が無いCSVで同一人物が
// 複数回来店すると複数レコードに分裂する事象)はcsvImportPipeline.test.tsで
// パイプライン全体を通して検証する(本ファイルは純粋関数のみを対象とする)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { decideCustomerMatch, findNameCandidates } from '../../../src/lib/import/customerMatcher';
import type { Customer } from '../../../src/types/riora.types';

function customer(id: string, name: string, firstVisitDate: string | null = '2026-01-01'): Customer {
  return {
    id, storeId: 'store-1', name, ageGroup: null, customerType: null, typeConfidence: 0,
    goalNote: null, weddingDate: null, acquisitionChannel: null, firstVisitDate, assignedStaffId: null,
    isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
    consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
  };
}

describe('findNameCandidates', () => {
  it('氏名キー(toNameKey)が一致する既存顧客を候補として返す', () => {
    const candidates = findNameCandidates('田中 花子', [customer('c1', '田中花子')]);
    expect(candidates).toEqual([{ customerId: 'c1', displayLabel: '田中花子(既存・2026-01-01)' }]);
  });

  it('一致しない場合は空配列', () => {
    expect(findNameCandidates('佐藤太郎', [customer('c1', '田中花子')])).toEqual([]);
  });
});

describe('decideCustomerMatch', () => {
  it('external_key_hashで一致する場合はmatched(氏名候補があっても優先する)', () => {
    const decision = decideCustomerMatch({
      matchedByHash: customer('c1', '田中花子'),
      nameCandidates: [{ customerId: 'c2', displayLabel: '別の田中花子' }],
    });
    expect(decision).toEqual({ status: 'matched', customerId: 'c1' });
  });

  it('hash一致が無く氏名候補が1件でもneeds_review(自動マージしない・最終判断は運用者に委ねる)', () => {
    const decision = decideCustomerMatch({
      matchedByHash: null,
      nameCandidates: [{ customerId: 'c1', displayLabel: '田中花子(既存・2026-01-01)' }],
    });
    expect(decision).toEqual({ status: 'needs_review', candidates: [{ customerId: 'c1', displayLabel: '田中花子(既存・2026-01-01)' }] });
  });

  it('hash一致も氏名候補も無い場合はnew', () => {
    const decision = decideCustomerMatch({ matchedByHash: null, nameCandidates: [] });
    expect(decision).toEqual({ status: 'new' });
  });
});

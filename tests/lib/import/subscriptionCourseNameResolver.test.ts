// ================================================================
// subscriptionCourseNameResolver 検証(BASE_TREATMENT_NAME_RESOLUTION・2026-09-14)
//
// サブスク明細itemNameがコース名を含まない場合(【サブスク決済日】等)に、同一顧客の
// 他のサブスク明細履歴(価格→コース名の逆引き・直近の名前付き明細)からコース名を
// 解決するロジックを検証する。
// ================================================================
import { describe, expect, it } from 'vitest';
import {
  resolveSubscriptionCourseName, buildBatchHistoryByCustomer, UNRESOLVED_COURSE_NAME,
} from '../../../src/lib/import/subscriptionCourseNameResolver';

describe('resolveSubscriptionCourseName', () => {
  it('itemName自体がコース名を含む場合は直接抽出する(履歴を見るまでもない)', () => {
    const result = resolveSubscriptionCourseName(
      '2026-07-10', 16000, '【サブスク契約】選べる肌改善コース 月1回', []
    );
    expect(result).toEqual({ courseName: '選べる肌改善コース', method: 'direct_extraction' });
  });

  it('履歴が無い場合はunresolvedを返す', () => {
    const result = resolveSubscriptionCourseName(
      '2026-07-10', 16000, '【サブスク決済日】※金額入力してお会計', []
    );
    expect(result).toEqual({ courseName: UNRESOLVED_COURSE_NAME, method: 'unresolved' });
  });

  it('同一金額の名前付き履歴があれば価格逆引きで解決する', () => {
    const history = [
      { date: '2026-05-10', itemName: '【サブスク契約】選べる肌改善コース 月1回', amount: 16000 },
    ];
    const result = resolveSubscriptionCourseName(
      '2026-07-10', 16000, '【サブスク決済日】※金額入力してお会計', history
    );
    expect(result).toEqual({ courseName: '選べる肌改善コース', method: 'price_lookup' });
  });

  it('金額が一致する履歴が無い場合は対象日以前で直近の名前付き履歴を採用する(契約変更を跨いだ場合の過去表示を書き換えない)', () => {
    const history = [
      { date: '2026-05-10', itemName: '【サブスク契約】ヒト幹細胞ベーシック 月1回', amount: 13000 },
      { date: '2026-07-21', itemName: '【サブスク契約】ヒト幹細胞ベーシック 月2回', amount: 26000 },
    ];
    // 06-10時点(プラン変更前)の決済(13000とは異なる金額で入力されたケースを想定)は
    // 07-21のプラン変更後ではなく、05-10時点の契約名を採用する。
    const result = resolveSubscriptionCourseName(
      '2026-06-10', 99999, '【サブスク決済日】※金額入力してお会計', history
    );
    expect(result).toEqual({ courseName: 'ヒト幹細胞ベーシック', method: 'nearest_history' });
  });

  it('対象日以前に名前付き履歴が無い場合は対象日以降で直近の履歴にフォールバックする', () => {
    const history = [
      { date: '2026-08-01', itemName: '【サブスク契約】造顔＋小顔＋ヒト幹細胞 月1回', amount: 21000 },
    ];
    const result = resolveSubscriptionCourseName(
      '2026-06-01', 99999, '【サブスク決済日】※金額入力してお会計', history
    );
    expect(result).toEqual({ courseName: '造顔＋小顔＋ヒト幹細胞', method: 'nearest_history' });
  });

  it('価格一致と履歴日付一致の両方が使える場合は価格一致を優先する', () => {
    const history = [
      { date: '2026-05-01', itemName: '【サブスク契約】選べる肌改善コース 月1回', amount: 16000 },
      { date: '2026-08-01', itemName: '【サブスク契約】ヒト幹細胞ベーシック 月2回', amount: 26000 },
    ];
    // 対象日(07-01)に最も近いのは08-01のヒト幹細胞ベーシックだが、金額(16000)が一致するのは
    // 05-01の選べる肌改善コースのため、価格一致を優先する。
    const result = resolveSubscriptionCourseName(
      '2026-07-01', 16000, '【サブスク決済日】※金額入力してお会計', history
    );
    expect(result.courseName).toBe('選べる肌改善コース');
    expect(result.method).toBe('price_lookup');
  });
});

describe('buildBatchHistoryByCustomer', () => {
  it('サブスク明細を持つ会計だけを顧客名ごとにグルーピングする', () => {
    const map = buildBatchHistoryByCustomer([
      {
        customerName: '大石凌平', visitDateTime: '2026-05-10T12:00:00+09:00',
        subscriptionPayments: [{ itemName: '【サブスク決済日】※金額入力してお会計', amount: 13000 }],
      },
      {
        customerName: '大石凌平', visitDateTime: '2026-07-21T12:00:00+09:00',
        subscriptionPayments: [{ itemName: '【サブスク契約】ヒト幹細胞ベーシック 月2回', amount: 26000 }],
      },
      {
        customerName: '井口悠', visitDateTime: '2026-06-01T12:00:00+09:00',
        subscriptionPayments: [],
      },
    ]);

    expect(map.get('大石凌平')).toEqual([
      { date: '2026-05-10', itemName: '【サブスク決済日】※金額入力してお会計', amount: 13000 },
      { date: '2026-07-21', itemName: '【サブスク契約】ヒト幹細胞ベーシック 月2回', amount: 26000 },
    ]);
    expect(map.has('井口悠')).toBe(false);
  });
});

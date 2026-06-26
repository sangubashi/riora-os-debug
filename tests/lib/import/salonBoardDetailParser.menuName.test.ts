// ================================================================
// aggregateCheckouts() の代表メニュー名選定 検証(Pass C: 名寄せ精度改善)
//
// 区分=施術/メニュー/オプション/サービスの行が0件/1件/複数件のいずれでも、
// menuResolver.resolveMenuId()が安定して呼べる代表値(menuName)を決定する。
// 複数件の場合は金額最大の行を採用する(会計の主たる施術と推定できるため)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { aggregateCheckouts, type SalonBoardDetailRow } from '../../../src/lib/import/salonBoardDetailParser';

let seq = 0;
function detailRow(opts: Partial<SalonBoardDetailRow> & { checkoutId: string; category: string }): SalonBoardDetailRow {
  seq += 1;
  return {
    lineNumber: seq,
    checkoutDate: '2026/06/01',
    checkoutTime: '12:00',
    checkoutType: '会計',
    genre: '',
    subCategory: '',
    itemName: '',
    unitPrice: 0,
    priceType: '円',
    quantity: 1,
    amount: 0,
    staffNameRaw: '鈴木',
    isDesignatedRaw: '指名あり',
    customerName: '田中花子',
    customerNumber: '',
    customerKana: '',
    bookingChannel: 'LINE',
    gender: '女性',
    newOrRepeat: '新規',
    ...opts,
  };
}

describe('aggregateCheckouts() の代表メニュー名選定', () => {
  it('区分=施術が1件のみの会計はそのitemNameをmenuNameにする', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: '毛穴洗浄', amount: 3000 }),
    ]);
    expect(aggregates[0].menuName).toBe('毛穴洗浄');
  });

  it('区分=施術/メニュー/オプション/サービスが複数件の会計は金額最大の行を採用する', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: '毛穴洗浄', amount: 3000 }),
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'ヒト幹細胞導入', amount: 3300 }),
      detailRow({ checkoutId: 'A1', category: 'オプション', itemName: '保湿パック', amount: 1000 }),
    ]);
    expect(aggregates[0].menuName).toBe('ヒト幹細胞導入');
  });

  it('区分=店販/割引のみ(施術系が0件)の会計はmenuName=空文字になる', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '店販', itemName: 'CELCOSクリーム', amount: 11000 }),
      detailRow({ checkoutId: 'A1', category: 'その他', subCategory: '割引', itemName: 'キャンペーン割引', amount: -1000, staffNameRaw: '' }),
    ]);
    expect(aggregates[0].menuName).toBe('');
  });

  it('区分=メニューが1件+区分=オプションが1件の会計はメニュー/オプションいずれも代表値の対象になり、金額の大きい方が採用される', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: 'メニュー', itemName: 'フェイシャルエステ 60分', amount: 3000 }),
      detailRow({ checkoutId: 'A1', category: 'オプション', itemName: '小顔矯正オプション', amount: 5000 }),
    ]);
    expect(aggregates[0].menuName).toBe('小顔矯正オプション');
  });
});

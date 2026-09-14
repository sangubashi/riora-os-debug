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
    expect(aggregates[0].baseTreatmentName).toBe('毛穴洗浄');
  });

  it('区分=施術/メニュー/オプション/サービスが複数件の会計は金額最大の行を採用する', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: '毛穴洗浄', amount: 3000 }),
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'ヒト幹細胞導入', amount: 3300 }),
      detailRow({ checkoutId: 'A1', category: 'オプション', itemName: '保湿パック', amount: 1000 }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('ヒト幹細胞導入');
  });

  it('区分=店販/割引のみ(施術系が0件)の会計はmenuName=空文字になる', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '店販', itemName: 'CELCOSクリーム', amount: 11000 }),
      detailRow({ checkoutId: 'A1', category: 'その他', subCategory: '割引', itemName: 'キャンペーン割引', amount: -1000, staffNameRaw: '' }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('');
  });

  it('区分=メニューが1件+区分=オプションが1件の会計はメニュー/オプションいずれも代表値の対象になり、金額の大きい方が採用される', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: 'メニュー', itemName: 'フェイシャルエステ 60分', amount: 3000 }),
      detailRow({ checkoutId: 'A1', category: 'オプション', itemName: '小顔矯正オプション', amount: 5000 }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('小顔矯正オプション');
  });
});

// ================================================================
// BASE_TREATMENT_NAME_RESOLUTION(2026-09-14): 「オプション：」プレフィックス品目名
// (実SalonBoard売上明細では区分は常に'施術'のまま、品目名でのみオプションと判別できる)
// の除外・サブスク契約コース名の直接抽出を検証する。
// ================================================================
describe('aggregateCheckouts() の基本施術メニュー名解決(BASE_TREATMENT_NAME_RESOLUTION)', () => {
  it('区分=施術で品目名が「オプション：」始まりの行は基本メニュー候補から除外され、optionLinesに入る', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'オプション：モデリングパック各種', amount: 3000 }),
    ]);
    // 小宮山様パターン: 唯一の施術系行がオプションのみの会計は、従来はこれが誤って
    // baseTreatmentNameとして採用されていた(BASE_TREATMENT_NAME_RESOLUTION修正前のバグ)。
    expect(aggregates[0].baseTreatmentName).toBe('');
    expect(aggregates[0].baseTreatmentNameSource).toBe('none');
    expect(aggregates[0].optionLines).toEqual([{ itemName: 'オプション：モデリングパック各種', amount: 3000 }]);
  });

  it('半角コロンの「オプション:」表記も同様に除外される', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'オプション:水素パック', amount: 2400 }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('');
    expect(aggregates[0].optionLines).toEqual([{ itemName: 'オプション:水素パック', amount: 2400 }]);
  });

  it('通常の施術行とオプション行が混在する会計は、オプションを除いた施術行(金額最大)が採用される', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'ヒト幹細胞ベーシックコース', amount: 13000 }),
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'オプション：ハイドラフェイシャル 1部位', amount: 15000 }),
    ]);
    // オプション行(15000)の方が金額が大きくても、基本メニューには採用しない。
    expect(aggregates[0].baseTreatmentName).toBe('ヒト幹細胞ベーシックコース');
    expect(aggregates[0].baseTreatmentNameSource).toBe('treatment_line');
    expect(aggregates[0].optionLines).toEqual([{ itemName: 'オプション：ハイドラフェイシャル 1部位', amount: 15000 }]);
  });

  it('サブスク明細itemNameがコース名を直接含む(【サブスク契約】)場合はそのコース名を採用する', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: '【サブスク契約】選べる肌改善コース 月1回', amount: 16000 }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('選べる肌改善コース');
    expect(aggregates[0].baseTreatmentNameSource).toBe('subscription_contract_named');
  });

  it('サブスク明細itemNameがコース名を含まない(【サブスク決済日】)場合はunresolvedのまま返す(履歴解決はcsvImportPipeline.ts側の責務)', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: '【サブスク決済日】※金額入力してお会計', amount: 16000 }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('');
    expect(aggregates[0].baseTreatmentNameSource).toBe('subscription_unresolved');
  });

  it('小宮山様パターン: 基本施術がサブスクでカバーされオプションのみ明細に残る会計は、オプション名ではなくサブスク明細から解決を試みる', () => {
    const { aggregates } = aggregateCheckouts([
      detailRow({ checkoutId: 'A1', category: '施術', itemName: 'オプション：モデリングパック各種', amount: 3850 }),
      detailRow({ checkoutId: 'A1', category: '施術', itemName: '【サブスク会員様】選べる肌改善コース', amount: 0 }),
    ]);
    expect(aggregates[0].baseTreatmentName).toBe('選べる肌改善コース');
    expect(aggregates[0].baseTreatmentNameSource).toBe('subscription_contract_named');
    expect(aggregates[0].optionLines).toEqual([{ itemName: 'オプション：モデリングパック各種', amount: 3850 }]);
  });
});

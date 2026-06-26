// ================================================================
// normalizer 検証(Pass D拡張: 半角カナ→全角カナ変換)
//
// CSV出力元(POS/旧システム)による半角カタカナ表記揺れに対する汎用Unicode変換
// (濁点・半濁点の合成含む)。店舗固有の別名辞書ではなく標準的な文字コード変換のため、
// 「暫定ハードコード禁止」の対象外(toHalfWidthの全角ASCII→半角ASCII変換と対称の処理)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { halfWidthKatakanaToFullWidth, normalizeStaffName, toNameKey } from '../../../src/lib/import/normalizer';

describe('halfWidthKatakanaToFullWidth', () => {
  it('濁点を含まない半角カタカナを全角カタカナへ変換する', () => {
    expect(halfWidthKatakanaToFullWidth('ﾅｶﾑﾗ')).toBe('ナカムラ');
  });

  it('濁点(ﾞ)付きの半角カタカナを正しく合成する', () => {
    expect(halfWidthKatakanaToFullWidth('ｶﾞ')).toBe('ガ');
    expect(halfWidthKatakanaToFullWidth('ﾔﾑﾐｸﾞﾆ')).toBe('ヤムミグニ'); // 'グ'の合成確認
  });

  it('半濁点(ﾟ)付きの半角カタカナを正しく合成する', () => {
    expect(halfWidthKatakanaToFullWidth('ﾋﾟｸﾆｸ')).toBe('ピクニク');
  });

  it('半角カタカナを含まない文字列はそのまま返す', () => {
    expect(halfWidthKatakanaToFullWidth('田中花子')).toBe('田中花子');
    expect(halfWidthKatakanaToFullWidth('ナカムラヨウコ')).toBe('ナカムラヨウコ');
  });
});

describe('toNameKey(顧客名カナ表記差異の吸収)', () => {
  it('半角カタカナと全角カタカナの氏名は同じ照合キーになる', () => {
    expect(toNameKey('ﾅｶﾑﾗﾐﾕｷ')).toBe(toNameKey('ナカムラミユキ'));
  });
});

describe('normalizeStaffName(ローマ字大文字小文字差異の吸収)', () => {
  it('大文字/小文字のローマ字表記は同じ正規化結果になる', () => {
    expect(normalizeStaffName('KAMEYAMA')).toBe(normalizeStaffName('kameyama'));
  });

  it('半角カタカナの担当者名は全角カタカナと同じ正規化結果になる', () => {
    expect(normalizeStaffName('ｶﾞｲﾄﾞｳ')).toBe(normalizeStaffName('ガイドウ'));
  });
});

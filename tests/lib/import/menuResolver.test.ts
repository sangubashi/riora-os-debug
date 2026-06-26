// ================================================================
// menuResolver 検証(Pass C: メニュー名名寄せ精度改善)
//
// resolveMenuId()の優先順位(exact_match > normalized_match > partial_match >
// fallback_other > unresolved)を検証する。brain_menus.role='imported_other'の
// 行はbuildMenuLookup()でフォールバック専用に分離され、通常の突合対象には含まれない。
// ================================================================
import { describe, expect, it } from 'vitest';
import { buildMenuLookup, resolveMenuId } from '../../../src/lib/import/menuResolver';
import type { Menu } from '../../../src/types/riora.types';

function menu(id: string, name: string, role: Menu['role'] = 'entry'): Menu {
  return { id, storeId: 'store-1', name, price: 1000, role, targetTypes: [] };
}

const FALLBACK = menu('menu-fallback', 'CSV取込(メニュー名未マッチ)', 'imported_other');

describe('buildMenuLookup / resolveMenuId', () => {
  it('元の文字列が完全一致する場合はexact_match', () => {
    const lookup = buildMenuLookup([menu('menu-1', 'ハーブピーリング9900'), FALLBACK]);
    const result = resolveMenuId('ハーブピーリング9900', lookup);
    expect(result).toEqual({ status: 'matched', menuId: 'menu-1', menuName: 'ハーブピーリング9900', method: 'exact_match' });
  });

  it('前後空白・全角半角・大文字小文字の違いはnormalized_match', () => {
    const lookup = buildMenuLookup([menu('menu-1', 'EMSフェイシャル'), FALLBACK]);
    // 小文字ems・内部に全角スペース
    const result = resolveMenuId('ems　フェイシャル', lookup);
    expect(result).toEqual({ status: 'matched', menuId: 'menu-1', menuName: 'EMSフェイシャル', method: 'normalized_match' });
  });

  it('CSV名がマスタ名の部分文字列の場合はpartial_match(毛穴洗浄 ⊂ 毛穴洗浄+ヒト幹19000)', () => {
    const lookup = buildMenuLookup([menu('menu-1', '毛穴洗浄+ヒト幹19000', 'pore'), FALLBACK]);
    const result = resolveMenuId('毛穴洗浄', lookup);
    expect(result).toEqual({ status: 'matched', menuId: 'menu-1', menuName: '毛穴洗浄+ヒト幹19000', method: 'partial_match' });
  });

  it('マスタ名がCSV名の部分文字列の場合もpartial_match(逆方向)', () => {
    const lookup = buildMenuLookup([menu('menu-1', 'ハーブピーリング', 'peeling'), FALLBACK]);
    const result = resolveMenuId('ハーブピーリング90分コース', lookup);
    expect(result).toEqual({ status: 'matched', menuId: 'menu-1', menuName: 'ハーブピーリング', method: 'partial_match' });
  });

  it('いずれにも一致しない場合はfallback_other(imported_other行へ集約)', () => {
    const lookup = buildMenuLookup([menu('menu-1', 'ヒト幹15000'), FALLBACK]);
    const result = resolveMenuId('フェイシャルエステ 60分', lookup);
    expect(result).toEqual({ status: 'fallback', menuId: 'menu-fallback', menuName: 'CSV取込(メニュー名未マッチ)', method: 'fallback_other' });
  });

  it('フォールバック行も存在しない場合はunresolved', () => {
    const lookup = buildMenuLookup([menu('menu-1', 'ヒト幹15000')]);
    const result = resolveMenuId('全く違うメニュー', lookup);
    expect(result).toEqual({ status: 'unresolved' });
  });

  it('空文字列はpartial_match走査をスキップしfallback_otherへ直行する(短すぎる文字列の誤爆防止)', () => {
    const lookup = buildMenuLookup([menu('menu-1', 'ヒト幹15000'), FALLBACK]);
    const result = resolveMenuId('', lookup);
    expect(result).toEqual({ status: 'fallback', menuId: 'menu-fallback', menuName: 'CSV取込(メニュー名未マッチ)', method: 'fallback_other' });
  });

  it('1文字のみの一致は部分一致対象外(MIN_PARTIAL_MATCH_LENGTHガード)', () => {
    // 'A'は'ABCマスタ'にもマッチしうるが、1文字同士の偶発一致を避けるため対象外にする
    const lookup = buildMenuLookup([menu('menu-1', 'A'), FALLBACK]);
    const result = resolveMenuId('ABCマスタ', lookup);
    expect(result.status).toBe('fallback');
  });

  it('複数のbrain_menusが存在しても各メニュー単位で正しく解決する', () => {
    const lookup = buildMenuLookup([
      menu('menu-1', 'ヒト幹15000', 'entry'),
      menu('menu-2', '毛穴洗浄+ヒト幹19000', 'pore'),
      menu('menu-3', '水素+ヒト幹18000', 'sensitive'),
      FALLBACK,
    ]);
    expect(resolveMenuId('ヒト幹15000', lookup).status).toBe('matched');
    expect(resolveMenuId('毛穴洗浄', lookup)).toMatchObject({ menuId: 'menu-2', method: 'partial_match' });
    expect(resolveMenuId('水素+ヒト幹18000', lookup)).toMatchObject({ menuId: 'menu-3', method: 'exact_match' });
  });
});

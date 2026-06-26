import { describe, expect, it } from 'vitest';
import { classifyCustomerType } from '../../../src/engines/customerType/CustomerTypeEngine';
import type { Menu, Visit } from '../../../src/types/riora.types';

function menu(overrides: Partial<Menu> = {}): Menu {
  return { id: 'menu-1', storeId: 'store-1', name: 'テストメニュー', price: 10000, role: 'entry', targetTypes: [], ...overrides };
}

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'visit-1', storeId: 'store-1', customerId: 'cust-1', staffId: 'staff-1', menuId: 'menu-1',
    visitDate: '2026-06-01', visitCountAt: 1, isNomination: false, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 50, ...overrides,
  };
}

describe('classifyCustomerType', () => {
  it('weddingDateが設定済みならE_bridal・confidence1を返す(来店履歴を見るより優先)', () => {
    const result = classifyCustomerType({
      weddingDate: '2026-09-01',
      visits: [visit({ menuId: 'menu-pore' })],
      menus: [menu({ id: 'menu-pore', targetTypes: ['B_pore'] })],
    });
    expect(result).toEqual({ customerType: 'E_bridal', confidence: 1, reason: 'wedding_date', evidenceVisitCount: 0 });
  });

  it('単独タイプを明示するメニューの来店があれば実信号として分類する', () => {
    const result = classifyCustomerType({
      weddingDate: null,
      visits: [visit({ menuId: 'menu-pore' })],
      menus: [menu({ id: 'menu-pore', targetTypes: ['B_pore'] })],
    });
    expect(result).toEqual({ customerType: 'B_pore', confidence: 1, reason: 'visit_menu_signal', evidenceVisitCount: 1 });
  });

  it('targetTypesが空のメニュー(CSV未マッチ等)は判別材料にしない', () => {
    const result = classifyCustomerType({
      weddingDate: null,
      visits: [visit({ menuId: 'menu-unmatched' })],
      menus: [menu({ id: 'menu-unmatched', targetTypes: [] })],
    });
    expect(result).toEqual({ customerType: null, confidence: 0, reason: 'no_classifiable_signal', evidenceVisitCount: 0 });
  });

  it('複数タイプを跨ぐ汎用メニュー(entry等)は判別材料にしない', () => {
    const result = classifyCustomerType({
      weddingDate: null,
      visits: [visit({ menuId: 'menu-entry' })],
      menus: [menu({ id: 'menu-entry', targetTypes: ['A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal'] })],
    });
    expect(result.customerType).toBeNull();
    expect(result.reason).toBe('no_classifiable_signal');
  });

  it('来店履歴が0件なら分類不可を返す', () => {
    const result = classifyCustomerType({ weddingDate: null, visits: [], menus: [] });
    expect(result).toEqual({ customerType: null, confidence: 0, reason: 'no_classifiable_signal', evidenceVisitCount: 0 });
  });

  it('複数の単独タイプメニューを使った場合は最頻出タイプ・実際の比率をconfidenceに反映する', () => {
    const result = classifyCustomerType({
      weddingDate: null,
      visits: [
        visit({ id: 'v1', menuId: 'menu-pore' }),
        visit({ id: 'v2', menuId: 'menu-pore' }),
        visit({ id: 'v3', menuId: 'menu-acne' }),
      ],
      menus: [
        menu({ id: 'menu-pore', targetTypes: ['B_pore'] }),
        menu({ id: 'menu-acne', targetTypes: ['A_acne'] }),
      ],
    });
    expect(result.customerType).toBe('B_pore');
    expect(result.confidence).toBeCloseTo(2 / 3);
    expect(result.evidenceVisitCount).toBe(3);
  });

  it('存在しないmenuIdを参照する来店は無視する(架空のメニューを補わない)', () => {
    const result = classifyCustomerType({
      weddingDate: null,
      visits: [visit({ menuId: 'menu-missing' })],
      menus: [menu({ id: 'menu-pore', targetTypes: ['B_pore'] })],
    });
    expect(result.customerType).toBeNull();
    expect(result.reason).toBe('no_classifiable_signal');
  });

  it('本番の実状態(全来店がtargetTypes空のフォールバックメニュー)を再現すると分類0件になる', () => {
    const fallbackMenu = menu({ id: 'fallback', name: 'CSV取込(メニュー名未マッチ)', role: 'imported_other', targetTypes: [] });
    const visits = Array.from({ length: 39 }, (_, i) => visit({ id: `v${i}`, menuId: 'fallback' }));
    const result = classifyCustomerType({ weddingDate: null, visits, menus: [fallbackMenu] });
    expect(result.customerType).toBeNull();
    expect(result.reason).toBe('no_classifiable_signal');
  });
});

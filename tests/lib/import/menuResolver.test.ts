// ================================================================
// menuResolver 検証(Pass C: メニュー名名寄せ精度改善)
//
// resolveMenuId()の優先順位(exact_match > normalized_match > partial_match >
// fallback_other > unresolved)を検証する。brain_menus.role='imported_other'の
// 行はbuildMenuLookup()でフォールバック専用に分離され、通常の突合対象には含まれない。
// ================================================================
import { describe, expect, it } from 'vitest';
import { buildMenuLookup, resolveMenuId, resolveOrCreateFallbackMenu } from '../../../src/lib/import/menuResolver';
import type { Menu } from '../../../src/types/riora.types';
import type { IMenuRepo, MenuCreateInput } from '../../../src/repositories/interfaces';

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

// ================================================================
// resolveOrCreateFallbackMenu(PHASE CSV-MENU-FALLBACK-IMPROVE)
//
// 未マッチのCSVメニュー名ごとにrole='imported_other'行を検索/新規作成する。
// resolveMenuId()自体(exact/normalized/partial/keyword_match)は変更されないため、
// 一致するケースはそちらのテストでカバー済み。ここではフォールバック経路のみ検証する。
// ================================================================
describe('resolveOrCreateFallbackMenu', () => {
  function createFakeMenuRepo(): IMenuRepo & { created: MenuCreateInput[] } {
    let seq = 0;
    const created: MenuCreateInput[] = [];
    return {
      created,
      listByStore: async () => [],
      findById: async () => null,
      create: async (input) => {
        seq += 1;
        created.push(input);
        return {
          id: `created-${seq}`, storeId: input.storeId, name: input.name,
          price: input.price, role: input.role, targetTypes: input.targetTypes,
        };
      },
      update: async () => null,
      softDelete: async () => {},
      countVisitsByMenuId: async () => 0,
    };
  }

  it('未マッチ名Aは新規にimported_other行を作成し、そのmenu_idを返す', async () => {
    const lookup = buildMenuLookup([menu('menu-1', 'カット'), FALLBACK]);
    const menuRepo = createFakeMenuRepo();

    const result = await resolveOrCreateFallbackMenu('毛穴洗浄コース', lookup, 'store-1', menuRepo);

    expect(result).toMatchObject({ status: 'fallback', menuName: '毛穴洗浄コース', method: 'fallback_other' });
    expect(menuRepo.created).toHaveLength(1);
    expect(menuRepo.created[0]).toMatchObject({ storeId: 'store-1', name: '毛穴洗浄コース', role: 'imported_other', price: 0 });
  });

  it('同じ未マッチ名Aを同一lookupで再解決すると、新規作成せず同じmenu_idを再利用する', async () => {
    const lookup = buildMenuLookup([menu('menu-1', 'カット'), FALLBACK]);
    const menuRepo = createFakeMenuRepo();

    const first = await resolveOrCreateFallbackMenu('毛穴洗浄コース', lookup, 'store-1', menuRepo);
    const second = await resolveOrCreateFallbackMenu('毛穴洗浄コース', lookup, 'store-1', menuRepo);

    expect(second).toEqual(first);
    expect(menuRepo.created).toHaveLength(1); // 2回目はDB作成されない
  });

  it('未マッチ名Bは未マッチ名Aとは別のmenu_idを新規作成する', async () => {
    const lookup = buildMenuLookup([menu('menu-1', 'カット'), FALLBACK]);
    const menuRepo = createFakeMenuRepo();

    const a = await resolveOrCreateFallbackMenu('毛穴洗浄コース', lookup, 'store-1', menuRepo);
    const b = await resolveOrCreateFallbackMenu('小顔フェイシャル', lookup, 'store-1', menuRepo);

    expect(a.status).toBe('fallback');
    expect(b.status).toBe('fallback');
    if (a.status === 'fallback' && b.status === 'fallback') {
      expect(a.menuId).not.toBe(b.menuId);
    }
    expect(menuRepo.created).toHaveLength(2);
  });

  it('既にDBに存在する未マッチ名(前回取込で作成済み)はlookup経由で再利用し、新規作成しない', async () => {
    const EXISTING_FALLBACK = menu('menu-existing-fallback', '毛穴洗浄コース', 'imported_other');
    const lookup = buildMenuLookup([menu('menu-1', 'カット'), FALLBACK, EXISTING_FALLBACK]);
    const menuRepo = createFakeMenuRepo();

    const result = await resolveOrCreateFallbackMenu('毛穴洗浄コース', lookup, 'store-1', menuRepo);

    expect(result).toEqual({ status: 'fallback', menuId: 'menu-existing-fallback', menuName: '毛穴洗浄コース', method: 'fallback_other' });
    expect(menuRepo.created).toHaveLength(0);
  });

  it('完全一致するメニューがあれば従来どおりmatched(exact_match)を返し、フォールバック処理には入らない', async () => {
    const lookup = buildMenuLookup([menu('menu-1', 'カット'), FALLBACK]);
    const menuRepo = createFakeMenuRepo();

    const result = await resolveOrCreateFallbackMenu('カット', lookup, 'store-1', menuRepo);

    expect(result).toEqual({ status: 'matched', menuId: 'menu-1', menuName: 'カット', method: 'exact_match' });
    expect(menuRepo.created).toHaveLength(0);
  });

  it('空文字(店販/割引のみの会計)は専用行を作らず店舗共有フォールバック行に集約する', async () => {
    const lookup = buildMenuLookup([menu('menu-1', 'カット'), FALLBACK]);
    const menuRepo = createFakeMenuRepo();

    const result = await resolveOrCreateFallbackMenu('', lookup, 'store-1', menuRepo);

    expect(result).toEqual({ status: 'fallback', menuId: 'menu-fallback', menuName: 'CSV取込(メニュー名未マッチ)', method: 'fallback_other' });
    expect(menuRepo.created).toHaveLength(0);
  });
});

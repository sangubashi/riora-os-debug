// ================================================================
// staffResolver 検証(Pass D: スタッフ名寄せ精度検証)
//
// 実データ調査で「外館」(U+9928)と「外舘」(U+8218)という見た目が非常に近い異体字が
// CSVとbrain_staff.nameで異なって使われており、正規化(normalizeStaffName)では
// 救済できず未解決になることが判明した(暫定ハードコードでの異体字辞書は作らない方針のため、
// 既存のbrain_staff.name_aliases機構での解決を前提とする・本テストで両方を検証する)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { buildStaffLookup, resolveStaffId } from '../../../src/lib/import/staffResolver';

describe('buildStaffLookup / resolveStaffId', () => {
  it('brain_staff.nameと完全一致する場合は解決する', () => {
    const lookup = buildStaffLookup([{ id: 'staff-1', name: '鈴木', nameAliases: [] }]);
    const result = resolveStaffId('鈴木', lookup);
    expect(result).toEqual({ status: 'resolved', staffId: 'staff-1', normalized: '鈴木' });
  });

  it('name_aliasesに登録済みの表記ゆれは解決する(画面⑥未解決スタッフ一覧→紐付けの正規ルート)', () => {
    const lookup = buildStaffLookup([{ id: 'staff-1', name: '亀山', nameAliases: ['カメヤマ', '亀山純佳'] }]);
    expect(resolveStaffId('カメヤマ', lookup)).toEqual({ status: 'resolved', staffId: 'staff-1', normalized: 'カメヤマ' });
    expect(resolveStaffId('亀山純佳', lookup)).toEqual({ status: 'resolved', staffId: 'staff-1', normalized: '亀山純佳' });
  });

  it('実データで判明: 異体字(外館 vs 外舘)はnormalizeStaffNameでは救済されず未解決になる', () => {
    // brain_staff.name = '外舘'(U+8218)。CSV側の実データは'外館'(U+9928・別の漢字)で出力されていた。
    const lookup = buildStaffLookup([{ id: 'staff-todate', name: '外舘', nameAliases: [] }]);
    const result = resolveStaffId('外館', lookup);
    expect(result.status).toBe('unresolved');
  });

  it('未解決の異体字はname_aliasesへの登録で解決できる(暫定ハードコードではなく既存機構で対応する方針)', () => {
    const lookup = buildStaffLookup([{ id: 'staff-todate', name: '外舘', nameAliases: ['外館'] }]);
    const result = resolveStaffId('外館', lookup);
    expect(result).toEqual({ status: 'resolved', staffId: 'staff-todate', normalized: '外館' });
  });

  it('登録済みスタッフのいずれにも一致しない場合は未解決', () => {
    const lookup = buildStaffLookup([{ id: 'staff-1', name: '鈴木', nameAliases: [] }]);
    const result = resolveStaffId('山田一郎', lookup);
    expect(result).toEqual({ status: 'unresolved', normalized: '山田一郎' });
  });

  it('ローマ字表記(大文字/小文字)はaliasに登録済みなら解決する(汎用大文字小文字統一+alias)', () => {
    const lookup = buildStaffLookup([{ id: 'staff-1', name: '亀山', nameAliases: ['KAMEYAMA'] }]);
    expect(resolveStaffId('KAMEYAMA', lookup).status).toBe('resolved');
    expect(resolveStaffId('kameyama', lookup).status).toBe('resolved'); // 大文字小文字差は汎用正規化で吸収
  });

  it('ニックネーム(亀山彩)は氏名の一部一致であっても自動解決しない(部分一致は行わない方針・誤紐付けのリスクを避ける)', () => {
    // メニュー名のpartial_match(Pass C)とは異なり、スタッフ名は人物の同定が誤ると
    // 売上の帰属(指名率・スタッフ分析)が直接誤るため、部分一致による自動解決は採用しない。
    const lookup = buildStaffLookup([{ id: 'staff-1', name: '亀山', nameAliases: [] }]);
    const result = resolveStaffId('亀山彩', lookup);
    expect(result.status).toBe('unresolved');
  });
});

// ================================================================
// computeCsvQualityReport 検証(Pass D: CSV Import完成・品質レポート)
//
// 実フォーマット(SalonBoardCheckoutAggregate[])向けの品質レポートを検証する。
// 既存csvQualityChecker.ts(旧フォーマット専用)とは独立した別関数。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeCsvQualityReport } from '../../../src/lib/import/csvImportQualityReport';
import { buildMenuLookup } from '../../../src/lib/import/menuResolver';
import type { SalonBoardCheckoutAggregate } from '../../../src/lib/import/salonBoardDetailParser';
import type { Menu } from '../../../src/types/riora.types';

function menu(id: string, name: string, role: Menu['role'] = 'entry'): Menu {
  return { id, storeId: 'store-1', name, price: 1000, role, targetTypes: [] };
}

let seq = 0;
function agg(opts: { customerName: string; menuName?: string }): SalonBoardCheckoutAggregate {
  seq += 1;
  return {
    checkoutId: `C${seq}`, lineNumber: seq, customerName: opts.customerName, customerNumber: '',
    customerKana: '', gender: '女性', visitDateTime: '2026-06-01T12:00:00+09:00', staffNameRaw: '鈴木',
    isDesignated: false, bookingChannel: 'LINE', isNewCustomer: true, menuName: opts.menuName ?? 'カット',
    netServiceSales: 5000, retailSales: 0, discountTotal: 0, optionNames: [], retailNames: [], serviceNames: [],
    lineItemCount: 1,
  };
}

const MENUS = [menu('menu-1', 'カット'), menu('menu-fallback', 'CSV取込(メニュー名未マッチ)', 'imported_other')];

describe('computeCsvQualityReport', () => {
  it('問題が無いCSVはscore=100/level=excellent/warningsは空', () => {
    const report = computeCsvQualityReport({
      aggregates: [agg({ customerName: '田中花子' }), agg({ customerName: '佐藤太郎' })],
      menuLookup: buildMenuLookup(MENUS), hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 0,
      needsReviewCount: 0,
    });
    expect(report.score).toBe(100);
    expect(report.level).toBe('excellent');
    expect(report.warnings).toEqual([]);
    expect(report.duplicateCustomerNames).toEqual([]);
  });

  it('未解決スタッフはseverity=errorで警告し、減点する(該当行が来店データとして取り込まれないため)', () => {
    const report = computeCsvQualityReport({
      aggregates: [agg({ customerName: '田中花子' })],
      menuLookup: buildMenuLookup(MENUS), hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 3,
      needsReviewCount: 0,
    });
    expect(report.warnings).toContainEqual(expect.objectContaining({ type: 'unresolved_staff', count: 3, severity: 'error' }));
    expect(report.score).toBeLessThan(100);
  });

  it('同一氏名が複数回出現する場合はduplicate_customer_nameとして検出する(自動マージはしない・警告のみ)', () => {
    const report = computeCsvQualityReport({
      aggregates: [
        agg({ customerName: '中村陽子' }),
        agg({ customerName: '中村陽子' }),
        agg({ customerName: '中村陽子' }),
        agg({ customerName: '佐藤太郎' }),
      ],
      menuLookup: buildMenuLookup(MENUS), hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 0,
      needsReviewCount: 0,
    });
    expect(report.duplicateCustomerNames).toEqual([{ name: '中村陽子', occurrenceCount: 3 }]);
    expect(report.warnings).toContainEqual(expect.objectContaining({ type: 'duplicate_customer_name', count: 1 }));
  });

  it('要確認(needsReview)件数が0より大きい場合はneeds_review_pendingを警告する', () => {
    const report = computeCsvQualityReport({
      aggregates: [agg({ customerName: '田中花子' })],
      menuLookup: buildMenuLookup(MENUS), hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 0,
      needsReviewCount: 2,
    });
    expect(report.warnings).toContainEqual(expect.objectContaining({ type: 'needs_review_pending', count: 2, severity: 'warn' }));
  });

  it('brain_menusと一致しないメニュー名(fallback_other)が有る場合はmenu_unmatchedをinfoで警告する', () => {
    const report = computeCsvQualityReport({
      aggregates: [agg({ customerName: '田中花子', menuName: '全く違うメニュー' })],
      menuLookup: buildMenuLookup(MENUS), hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 0,
      needsReviewCount: 0,
    });
    expect(report.menuResolution.fallbackOther).toBe(1);
    expect(report.warnings).toContainEqual(expect.objectContaining({ type: 'menu_unmatched', count: 1, severity: 'info' }));
  });

  it('複数の問題が重なるとscoreが累積的に下がりlevelがpoorになる', () => {
    const report = computeCsvQualityReport({
      aggregates: [
        agg({ customerName: '中村陽子' }), agg({ customerName: '中村陽子' }),
        agg({ customerName: '田中花子' }), agg({ customerName: '田中花子' }),
        agg({ customerName: '佐藤太郎' }), agg({ customerName: '佐藤太郎' }),
      ],
      menuLookup: buildMenuLookup(MENUS), hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 5,
      needsReviewCount: 4,
    });
    expect(report.level).toBe('poor');
    expect(report.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('ratesを総checkout数に対する割合として算出する(最終報告の必須記載項目)', () => {
    const report = computeCsvQualityReport({
      aggregates: [
        agg({ customerName: 'A' }), agg({ customerName: 'B' }),
        agg({ customerName: 'C' }), agg({ customerName: 'D' }),
      ],
      menuLookup: buildMenuLookup(MENUS),
      hashMatchedCount: 1, nameProximityMatchedCount: 1, visitProximityClosestCount: 1, proximityReviewCount: 2, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 1,
      needsReviewCount: 0,
    });
    expect(report.rates.customerResolutionRate).toBe(0.25); // 1/4(会員番号一致)
    expect(report.rates.nameProximityResolutionRate).toBe(0.25); // 1/4(氏名+来店日近傍一致)
    expect(report.rates.combinedCustomerResolutionRate).toBe(0.5); // (1+1)/4
    expect(report.rates.staffResolutionRate).toBe(0.75);    // 1 - 1/4
    expect(report.rates.menuResolutionRate).toBe(1);        // 全件exact_match
    expect(report.rates.importedOtherRate).toBe(0);
    expect(report.rates.errorCount).toBe(0);
    expect(report.rates.skippedCount).toBe(1);
    expect(report.proximityMatchCount).toBe(1);
    expect(report.visitProximityClosestCount).toBe(1);
    expect(report.proximityReviewCount).toBe(2);
  });

  it('totalCheckouts=0の場合は全rateが0になる(ゼロ除算を起こさない)', () => {
    const report = computeCsvQualityReport({
      aggregates: [], menuLookup: buildMenuLookup(MENUS),
      hashMatchedCount: 0, nameProximityMatchedCount: 0, visitProximityClosestCount: 0, proximityReviewCount: 0, parseLevelErrorCount: 0, menuUnresolvedSkippedCount: 0,
      unresolvedStaffCount: 0, needsReviewCount: 0,
    });
    expect(report.rates).toEqual({
      customerResolutionRate: 0, nameProximityResolutionRate: 0, combinedCustomerResolutionRate: 0,
      staffResolutionRate: 1, menuResolutionRate: 1,
      importedOtherRate: 0, errorCount: 0, skippedCount: 0,
    });
  });
});

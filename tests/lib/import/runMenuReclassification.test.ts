// ================================================================
// runMenuReclassification 検証
//
// PHASE CSV-RECOVERY-1: recoverFallbackNames/dryRunオプションの追加を検証する。
// 既存の再分類ロジック(resolveMenuId()の'matched'結果のみを使う再分類)は
// recoverFallbackNames省略時に完全に同じ挙動であることも回帰確認する。
// Supabaseを使わず、I*Repoインターフェースのin-memory fakeで検証する
// (tests/lib/import/csvImportPipeline.test.tsと同じ方針)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { runMenuReclassification, type ReclassificationRepos } from '../../../src/lib/import/runMenuReclassification';
import type { Customer, Menu, Visit } from '../../../src/types/riora.types';

const STORE_ID = 'store-1';

const HEADER =
  '会計日,会計時間,会計ID,会計区分,区分,ジャンル,カテゴリ,メニュー・店販・割引・サービス・オプション,単価,単価区分,個数,金額,スタッフ,指名,お客様名,お客様番号,お客様名（フリガナ）,予約経路,性別,新規再来';

function row(opts: {
  checkoutId: string;
  date: string;
  customerName: string;
  menu: string;
  amount?: number;
}): string {
  const { checkoutId, date, customerName, menu, amount = 5000 } = opts;
  return [
    date, '12:00', checkoutId, '通常', 'メニュー', 'ヘア', 'カット', menu,
    amount, '通常', 1, amount, '鈴木', 'あり', customerName, '', '', 'LINE', '女性', '再来',
  ].join(',');
}

function buildCsv(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

function createFakeRepos(opts: { menus: Menu[]; customers: Customer[]; visits: Visit[] }): ReclassificationRepos & {
  state: { visits: Visit[]; menus: Menu[] }
} {
  const state = { visits: opts.visits.slice(), menus: opts.menus.slice() };
  let menuSeq = 0;

  const repos: ReclassificationRepos = {
    customerRepo: {
      findById: async (id) => opts.customers.find((c) => c.id === id) ?? null,
      listByStore: async () => opts.customers,
      findByExternalKeyHash: async () => null,
      create: async () => { throw new Error('not implemented in test fake'); },
      patchFromImport: async () => { throw new Error('not implemented in test fake'); },
      updateCustomerType: async () => { throw new Error('not implemented in test fake'); },
    },
    menuRepo: {
      listByStore: async () => state.menus,
      findById: async (id) => state.menus.find((m) => m.id === id) ?? null,
      create: async (input) => {
        menuSeq += 1;
        const created: Menu = {
          id: `menu-created-${menuSeq}`, storeId: input.storeId, name: input.name,
          price: input.price, role: input.role, targetTypes: input.targetTypes,
        };
        state.menus.push(created);
        return created;
      },
      update: async () => null,
      softDelete: async () => {},
      countVisitsByMenuId: async () => 0,
    },
    visitRepo: {
      recentByCustomer: async () => [],
      create: async () => { throw new Error('not implemented in test fake'); },
      countByCustomer: async () => 0,
      createSequenced: async () => { throw new Error('not implemented in test fake'); },
      findByCustomerAndDate: async (customerId, visitDate) =>
        state.visits.find((v) => v.customerId === customerId && v.visitDate === visitDate) ?? null,
      reconcile: async () => { throw new Error('not implemented in test fake'); },
      sumSalesByStoreAndDate: async () => 0,
      listByStore: async (storeId) => state.visits.filter((v) => v.storeId === storeId),
      updateMenuId: async (id, menuId) => {
        const v = state.visits.find((x) => x.id === id && x.source === 'salonboard_import');
        if (v) v.menuId = menuId;
      },
      updateNextBookingMade: async () => {},
    },
  };

  return { ...repos, state };
}

function customer(id: string, name: string): Customer {
  return {
    id, storeId: STORE_ID, name, ageGroup: null, customerType: null, typeConfidence: 0,
    goalNote: null, weddingDate: null, acquisitionChannel: null, firstVisitDate: '2026-01-01',
    assignedStaffId: null, isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
    consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
  };
}

function visit(opts: {
  id: string; customerId: string; menuId: string; visitDate: string; treatmentAmount?: number;
}): Visit {
  return {
    id: opts.id, storeId: STORE_ID, customerId: opts.customerId, staffId: 'staff-1',
    menuId: opts.menuId, visitDate: opts.visitDate, visitCountAt: 1, isNomination: false,
    treatmentAmount: opts.treatmentAmount ?? 10000, retailAmount: 0, retailCategory: null,
    homecarePurchased: false, homecareDeclined: false, nextBookingMade: false, noBookingReason: null,
    voiceMemoUrl: null, visitScore: 0, source: 'salonboard_import',
  };
}

const FALLBACK_MENU: Menu = { id: 'menu-fallback', storeId: STORE_ID, name: 'CSV取込(メニュー名未マッチ)', price: 0, role: 'imported_other', targetTypes: [] };

describe('runMenuReclassification', () => {
  describe('既存挙動(recoverFallbackNames省略)', () => {
    it('matchedになった行のみ即座に更新し、unmatchedはskipする(既存挙動のまま)', async () => {
      const menus: Menu[] = [
        { id: 'menu-1', storeId: STORE_ID, name: 'カット', price: 5000, role: 'entry', targetTypes: [] },
        FALLBACK_MENU,
      ];
      const customers = [customer('cust-1', '田中花子'), customer('cust-2', '佐藤太郎')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-fallback', visitDate: '2026-06-01' }),
        visit({ id: 'visit-2', customerId: 'cust-2', menuId: 'menu-fallback', visitDate: '2026-06-02' }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: 'カット' }),
        row({ checkoutId: 'A2', date: '2026-06-02', customerName: '佐藤太郎', menu: '謎のメニュー' }),
      ]);

      const report = await runMenuReclassification({ storeId: STORE_ID, csvText: csv }, repos);

      expect(report.dryRun).toBe(false);
      expect(report.updated).toBe(1);
      expect(report.skipped).toBe(1); // 謎のメニュー(unmatched)はskip
      expect(repos.state.visits.find((v) => v.id === 'visit-1')?.menuId).toBe('menu-1');
      expect(repos.state.visits.find((v) => v.id === 'visit-2')?.menuId).toBe('menu-fallback'); // 変更されない
      // 復元用のimported_other行は作られない(recoverFallbackNames無効のため)
      expect(repos.state.menus.filter((m) => m.role === 'imported_other')).toHaveLength(1);
    });
  });

  describe('PHASE CSV-RECOVERY-1: recoverFallbackNames', () => {
    it('dry-run(デフォルト)ではDBへ一切書き込まず、変更予定の一覧だけを返す', async () => {
      const menus: Menu[] = [
        { id: 'menu-1', storeId: STORE_ID, name: 'カット', price: 5000, role: 'entry', targetTypes: [] },
        FALLBACK_MENU,
      ];
      const customers = [customer('cust-1', '田中花子')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-fallback', visitDate: '2026-06-01', treatmentAmount: 17000 }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: '毛穴洗浄コース' }),
      ]);

      const report = await runMenuReclassification({ storeId: STORE_ID, csvText: csv, recoverFallbackNames: true }, repos);

      expect(report.dryRun).toBe(true);
      expect(report.updated).toBe(1);
      expect(report.details[0]).toMatchObject({
        rawMenuName: '毛穴洗浄コース', beforeMenuId: 'menu-fallback', applied: false, method: 'fallback_other_recovered',
      });
      // 書き込みが一切発生していないことを確認
      expect(repos.state.visits.find((v) => v.id === 'visit-1')?.menuId).toBe('menu-fallback');
      expect(repos.state.menus.filter((m) => m.role === 'imported_other')).toHaveLength(1);
    });

    it('dryRun:falseを指定すると、実際にimported_other行を新規作成してmenu_idを更新する', async () => {
      const menus: Menu[] = [
        { id: 'menu-1', storeId: STORE_ID, name: 'カット', price: 5000, role: 'entry', targetTypes: [] },
        FALLBACK_MENU,
      ];
      const customers = [customer('cust-1', '田中花子')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-fallback', visitDate: '2026-06-01', treatmentAmount: 17000 }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: '毛穴洗浄コース' }),
      ]);

      const report = await runMenuReclassification(
        { storeId: STORE_ID, csvText: csv, recoverFallbackNames: true, dryRun: false }, repos,
      );

      expect(report.dryRun).toBe(false);
      expect(report.updated).toBe(1);
      expect(report.details[0].applied).toBe(true);
      const updatedMenuId = repos.state.visits.find((v) => v.id === 'visit-1')?.menuId;
      expect(updatedMenuId).not.toBe('menu-fallback');
      const createdMenu = repos.state.menus.find((m) => m.id === updatedMenuId);
      expect(createdMenu).toMatchObject({ name: '毛穴洗浄コース', role: 'imported_other' });
    });

    it('treatment_amount=0の来店は復元対象から除外する', async () => {
      const menus: Menu[] = [FALLBACK_MENU];
      const customers = [customer('cust-1', '田中花子')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-fallback', visitDate: '2026-06-01', treatmentAmount: 0 }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: '毛穴洗浄コース' }),
      ]);

      const report = await runMenuReclassification(
        { storeId: STORE_ID, csvText: csv, recoverFallbackNames: true, dryRun: false }, repos,
      );

      expect(report.updated).toBe(0);
      expect(report.skipped).toBe(1);
      expect(repos.state.visits[0].menuId).toBe('menu-fallback');
      expect(repos.state.menus).toHaveLength(1); // 新規作成されない
    });

    it('既にimported_other以外(実メニュー等)に設定済みの来店は対象外(手動設定を保護)', async () => {
      const menus: Menu[] = [
        { id: 'menu-manual', storeId: STORE_ID, name: '手動設定済みメニュー', price: 8000, role: 'entry', targetTypes: [] },
        FALLBACK_MENU,
      ];
      const customers = [customer('cust-1', '田中花子')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-manual', visitDate: '2026-06-01', treatmentAmount: 8000 }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: '毛穴洗浄コース' }),
      ]);

      const report = await runMenuReclassification(
        { storeId: STORE_ID, csvText: csv, recoverFallbackNames: true, dryRun: false }, repos,
      );

      expect(report.updated).toBe(0);
      expect(report.skipped).toBe(1);
      expect(repos.state.visits[0].menuId).toBe('menu-manual');
    });

    it('同じ未マッチ名を複数visitで復元しても、imported_other行は1つだけ作成される(同一CSV内)', async () => {
      const menus: Menu[] = [FALLBACK_MENU];
      const customers = [customer('cust-1', '田中花子'), customer('cust-2', '佐藤太郎')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-fallback', visitDate: '2026-06-01', treatmentAmount: 12000 }),
        visit({ id: 'visit-2', customerId: 'cust-2', menuId: 'menu-fallback', visitDate: '2026-06-02', treatmentAmount: 13000 }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: '毛穴洗浄コース' }),
        row({ checkoutId: 'A2', date: '2026-06-02', customerName: '佐藤太郎', menu: '毛穴洗浄コース' }),
      ]);

      const report = await runMenuReclassification(
        { storeId: STORE_ID, csvText: csv, recoverFallbackNames: true, dryRun: false }, repos,
      );

      expect(report.updated).toBe(2);
      const menuId1 = repos.state.visits.find((v) => v.id === 'visit-1')?.menuId;
      const menuId2 = repos.state.visits.find((v) => v.id === 'visit-2')?.menuId;
      expect(menuId1).toBe(menuId2);
      expect(repos.state.menus.filter((m) => m.role === 'imported_other' && m.name === '毛穴洗浄コース')).toHaveLength(1);
    });

    it('同一CSVを再度dry-runで実行しても冪等(既に復元済みならnoChangeになる)', async () => {
      const menus: Menu[] = [FALLBACK_MENU];
      const customers = [customer('cust-1', '田中花子')];
      const visits = [
        visit({ id: 'visit-1', customerId: 'cust-1', menuId: 'menu-fallback', visitDate: '2026-06-01', treatmentAmount: 17000 }),
      ];
      const repos = createFakeRepos({ menus, customers, visits });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', customerName: '田中花子', menu: '毛穴洗浄コース' }),
      ]);

      await runMenuReclassification({ storeId: STORE_ID, csvText: csv, recoverFallbackNames: true, dryRun: false }, repos);
      const second = await runMenuReclassification({ storeId: STORE_ID, csvText: csv, recoverFallbackNames: true }, repos);

      expect(second.dryRun).toBe(true);
      expect(second.updated).toBe(0);
      expect(second.noChange).toBe(1);
    });
  });
});

// ================================================================
// csvImportPipeline 検証
//
// 要件(ユーザー指定・優先1):
//   dry-run: DB書込禁止 / unresolved_staff集計 / menu_count_anomaly集計 /
//            customer match判定 / import summary生成
//   import:  brain_customers UPSERT / brain_visits UPSERT / reconciled対応 /
//            brain_ops_logs記録 / 冪等性(同一CSVを複数回投入しても重複作成しない)
//
// 本テストはSupabaseを使わず、I*Repoインターフェースのin-memory fakeで
// オーケストレーション(csvImportPipeline.ts)のみを検証する。
// ================================================================
import { describe, expect, it } from 'vitest';
import { buildDryRunResult, runImportPipeline, type PipelineRepos } from '../../../src/lib/import/csvImportPipeline';
import { hashExternalKey } from '../../../src/lib/import/piiSanitizer';
import type { Customer, Menu, OpsLog, Staff, Store, Visit } from '../../../src/types/riora.types';

const STORE_ID = 'store-1';

const HEADER =
  '会計日,会計時間,会計ID,会計区分,区分,ジャンル,カテゴリ,メニュー・店販・割引・サービス・オプション,単価,単価区分,個数,金額,スタッフ,指名,お客様名,お客様番号,お客様名（フリガナ）,予約経路,性別,新規再来';

function row(opts: {
  checkoutId: string;
  date: string;
  time?: string;
  staff: string;
  customerName: string;
  customerNumber?: string;
  menu?: string;
  amount?: number;
}): string {
  const {
    checkoutId, date, time = '12:00', staff, customerName,
    customerNumber = '', menu = 'カット', amount = 5000,
  } = opts;
  return [
    date, time, checkoutId, '通常', 'メニュー', 'ヘア', 'カット', menu,
    amount, '通常', 1, amount, staff, 'あり', customerName, customerNumber, '', 'LINE', '女性', '再来',
  ].join(',');
}

// 実SalonBoard売上明細の1明細行を組み立てる(row()より低レベル・区分/カテゴリを指定できる)。
// 区分=施術/店販/その他、会計区分="会計"、指名="指名あり"/"指名なし"が実フォーマット
// (row()が使う区分=メニュー/会計区分=通常/指名=あり はデモ生成CSV向けの旧フォーマット)。
function detailRow(opts: {
  checkoutId: string;
  date: string;
  time?: string;
  category: string;
  subCategory?: string;
  itemName?: string;
  amount: number;
  staff?: string;
  isDesignatedRaw?: string;
  customerName: string;
  customerNumber?: string;
  newOrRepeat?: string;
  checkoutType?: string;
}): string {
  const {
    checkoutId, date, time = '12:00', category, subCategory = '', itemName = '',
    amount, staff = '鈴木', isDesignatedRaw = '指名あり', customerName, customerNumber = '',
    newOrRepeat = '新規', checkoutType = '会計',
  } = opts;
  return [
    date, time, checkoutId, checkoutType, category, '', subCategory, itemName,
    amount, '円', 1, amount, staff, isDesignatedRaw, customerName, customerNumber, '', 'LINE', '女性', newOrRepeat,
  ].join(',');
}

function buildCsv(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

// ─── in-memory fake repos ───────────────────────────────────────────────────

function createFakeRepos(opts: { staff?: Staff[]; menus?: Menu[] } = {}): PipelineRepos & { state: {
  customers: Customer[];
  visits: Visit[];
  opsLogs: OpsLog[];
} } {
  const store: Store = {
    id: STORE_ID, name: 'テスト店舗', anonId: 'anon-1', anonSalt: 'fixed-test-salt',
    cluster: 'default', priceTier: 'standard', brainSubscription: true, learningMode: true,
  };
  const staff: Staff[] = opts.staff ?? [
    { id: 'staff-1', storeId: STORE_ID, name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] },
  ];
  // Pass C以降、menuNameは区分=施術/メニュー/オプション/サービスの代表行(金額最大)の品目名
  // から解決を試みる(salonBoardDetailParser.ts参照)。区分=店販/割引のみの会計はmenuName=''
  // となり、本番店舗と同様にimported_otherフォールバックへ集約される。フォールバック無しの
  // 挙動を検証するテストはopts.menusで明示的に上書きする。
  const menus: Menu[] = opts.menus ?? [
    { id: 'menu-1', storeId: STORE_ID, name: 'カット', price: 5000, role: 'entry', targetTypes: [] },
    { id: 'menu-fallback', storeId: STORE_ID, name: 'CSV取込(メニュー名未マッチ)', price: 0, role: 'imported_other', targetTypes: [] },
  ];

  const state = {
    customers: [] as Customer[],
    visits: [] as Visit[],
    opsLogs: [] as OpsLog[],
  };
  let customerSeq = 0;
  let visitSeq = 0;

  const repos: PipelineRepos = {
    storeRepo: {
      findById: async (id) => (id === store.id ? store : null),
    },
    staffRepo: {
      listByStore: async () => staff,
      addNameAlias: async () => null,
      deactivate: async () => null,
      create: async () => { throw new Error('not implemented in test fake'); },
    },
    menuRepo: {
      listByStore: async () => menus,
      findById: async () => null,
      create: async (input) => ({ id: 'menu-new', storeId: input.storeId, name: input.name, price: input.price, role: input.role, targetTypes: input.targetTypes }),
      update: async () => null,
      softDelete: async () => {},
      countVisitsByMenuId: async () => 0,
    },
    customerRepo: {
      findById: async (id) => state.customers.find(c => c.id === id) ?? null,
      listByStore: async () => [...state.customers],
      findByExternalKeyHash: async (_storeId, hash) => state.customers.find(c => c.externalKeyHash === hash) ?? null,
      create: async (input) => {
        customerSeq += 1;
        const created: Customer = {
          id: `cust-${customerSeq}`,
          storeId: input.storeId,
          name: input.name,
          ageGroup: input.ageGroup,
          customerType: null,
          typeConfidence: 0,
          goalNote: null,
          weddingDate: null,
          acquisitionChannel: null,
          firstVisitDate: input.firstVisitDate,
          assignedStaffId: null,
          isSubscriber: false,
          subscribedAt: null,
          churnScore: 0,
          churnReason: null,
          consentAnonymizedLearning: false,
          prefecture: input.prefecture,
          city: input.city,
          externalKeyHash: input.externalKeyHash,
        };
        state.customers.push(created);
        return created;
      },
      patchFromImport: async (id, input) => {
        const c = state.customers.find(x => x.id === id);
        if (!c) throw new Error('not found');
        c.ageGroup = c.ageGroup ?? input.ageGroup;
        c.firstVisitDate = c.firstVisitDate ?? input.firstVisitDate;
        c.prefecture = c.prefecture ?? input.prefecture;
        c.city = c.city ?? input.city;
        return c;
      },
      updateCustomerType: async (id, input) => {
        const c = state.customers.find(x => x.id === id);
        if (!c) throw new Error('not found');
        c.customerType = input.customerType;
        c.typeConfidence = input.typeConfidence;
        return c;
      },
    },
    visitRepo: {
      recentByCustomer: async (customerId, n) =>
        state.visits.filter(v => v.customerId === customerId).slice(0, n),
      countByCustomer: async (customerId) =>
        state.visits.filter(v => v.customerId === customerId).length,
      findByCustomerAndDate: async (customerId, visitDate) =>
        state.visits.find(v => v.customerId === customerId && v.visitDate === visitDate) ?? null,
      create: async (visit) => {
        visitSeq += 1;
        const created: Visit = { ...visit, id: `visit-${visitSeq}` };
        state.visits.push(created);
        return created;
      },
      // MD-5D: csvImportPipeline.tsはcountByCustomer()+create()ではなくcreateSequenced()を
      // 呼ぶ。visitCountAtは受け取らず、fake側でCOALESCE(MAX(visit_count_at),0)+1相当を
      // 顧客ごとに算出する(本番RPC insert_visit_with_sequenceと同じ採番方式)。
      createSequenced: async (visit) => {
        visitSeq += 1;
        const priorForCustomer = state.visits.filter(v => v.customerId === visit.customerId);
        const nextVisitCountAt = priorForCustomer.length > 0
          ? Math.max(...priorForCustomer.map(v => v.visitCountAt)) + 1
          : 1;
        const created: Visit = { ...visit, id: `visit-${visitSeq}`, visitCountAt: nextVisitCountAt };
        state.visits.push(created);
        return created;
      },
      reconcile: async (id, input) => {
        const v = state.visits.find(x => x.id === id);
        if (!v) throw new Error('not found');
        v.staffId = input.staffId;
        v.menuId = input.menuId;
        v.isNomination = input.isNomination;
        v.treatmentAmount = input.treatmentAmount;
        v.retailAmount = input.retailAmount;
        v.source = 'reconciled';
        return v;
      },
      sumSalesByStoreAndDate: async (storeId, visitDate) =>
        state.visits
          .filter(v => v.storeId === storeId && v.visitDate === visitDate)
          .reduce((sum, v) => sum + v.treatmentAmount + v.retailAmount, 0),
      listByStore: async (storeId) =>
        state.visits.filter(v => v.storeId === storeId).slice().sort((a, b) => a.visitDate.localeCompare(b.visitDate)),
      updateMenuId: async (id, menuId) => {
        const v = state.visits.find(x => x.id === id && x.source === 'salonboard_import')
        if (v) v.menuId = menuId
      },
    },
    opsLogRepo: {
      insert: async (log) => {
        const created: OpsLog = { ...log, id: `log-${state.opsLogs.length + 1}`, createdAt: new Date().toISOString() };
        state.opsLogs.push(created);
        return created;
      },
      recentByStoreAndKind: async (storeId, kind, n) =>
        state.opsLogs.filter(l => l.storeId === storeId && l.kind === kind).slice(0, n),
    },
    // Phase 1-Bc: csvImportPipeline.tsがvisit確定直後にrecordProposalOutcome()を呼ぶが、
    // このテストでは事前にfire_logを積んでいないため常に候補0件(no_eligible_fire_log)で
    // 早期returnする。既存テストの挙動(outcomes書込なし)を変えないための最小フェイク。
    briefingRepo: {
      latestByCustomer: async () => null,
      insert: async (input) => ({
        id: 'fire-log-fake', customerId: input.customerId, customerName: '', visitId: input.visitId,
        decisionRecord: input.decisionRecord as unknown as import('../../../src/types/riora.types').DecisionRecord,
        explanation: input.explanation, createdAt: new Date().toISOString(),
      }),
      recentByCustomer: async () => [],
    },
    outcomeRepo: {
      recent: async () => [],
      create: async () => ({ id: 'outcome-fake' }),
    },
  };

  return { ...repos, state };
}

describe('csvImportPipeline', () => {
  describe('buildDryRunResult', () => {
    it('DBへ一切書込まずにunresolved_staff/needsReview/importableを集計する', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001' }),
        row({ checkoutId: 'A2', date: '2026-06-02', staff: '未知のスタッフ', customerName: '佐藤太郎' }),
      ]);

      const result = await buildDryRunResult({ storeId: STORE_ID, fileName: 'test.csv', csvText: csv }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.totalRows).toBe(2);
      expect(result.result.unresolvedStaff).toHaveLength(1);
      expect(result.result.unresolvedStaff[0].rawName).toBe('未知のスタッフ');
      expect(result.result.importable).toBe(2);

      // dry-runはDBに何も書込まない
      expect(repos.state.customers).toHaveLength(0);
      expect(repos.state.visits).toHaveLength(0);
      expect(repos.state.opsLogs).toHaveLength(0);
    });

    it('実フォーマット(区分=施術が複数行+その他の割引行+スタッフ空欄行)を1件のimportable会計として集計する', async () => {
      const repos = createFakeRepos();
      // 実SalonBoard売上明細の典型パターン: 施術行が複数(オプション2件)・割引行(区分=その他+
      // カテゴリ=割引・スタッフ空欄)・店販行が同一checkoutIdに混在する
      const csv = buildCsv([
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '施術', subCategory: 'フェイシャル', itemName: 'オプション：毛穴洗浄', amount: 3000, customerName: '田中花子', customerNumber: 'C001' }),
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '施術', subCategory: 'フェイシャル', itemName: 'オプション：ヒト幹細胞導入', amount: 3300, customerName: '田中花子', customerNumber: 'C001' }),
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '店販', subCategory: 'その他', itemName: 'CELCOSクリーム', amount: 11000, customerName: '田中花子', customerNumber: 'C001' }),
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: 'その他', subCategory: '割引', itemName: 'キャンペーン割引', amount: -1000, staff: '', isDesignatedRaw: '', customerName: '田中花子', customerNumber: 'C001' }),
      ]);

      const result = await buildDryRunResult({ storeId: STORE_ID, fileName: 'test.csv', csvText: csv }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.skipped).toHaveLength(0);
      expect(result.result.importable).toBe(4);
    });

    it('会員番号が一致する既存顧客をmatched判定する(needsReviewに出さない)', async () => {
      const repos = createFakeRepos();
      const hash = hashExternalKey('C001', 'fixed-test-salt');
      repos.state.customers.push({
        id: 'cust-existing', storeId: STORE_ID, name: '田中花子', ageGroup: null, customerType: null,
        typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
        firstVisitDate: '2026-01-01', assignedStaffId: null, isSubscriber: false, subscribedAt: null,
        churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
        prefecture: null, city: null, externalKeyHash: hash,
      });

      const csv = buildCsv([
        row({ checkoutId: 'C1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001' }),
      ]);
      const result = await buildDryRunResult({ storeId: STORE_ID, fileName: 'test.csv', csvText: csv }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.needsReview).toHaveLength(0);
    });
  });

  describe('runImportPipeline', () => {
    it('新規顧客+来店を作成し、brain_ops_logsへ記録する', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.newCustomers).toBe(1);
      expect(result.report.visitsImported).toBe(1);
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.visits).toHaveLength(1);
      expect(repos.state.visits[0].source).toBe('salonboard_import');
      // row()のデフォルトmenu='カット'はmenus(デフォルト)の'menu-1'(name='カット')と完全一致する
      // (Pass C: menuNameが代表行の品目名から解決されるようになったため、以前は常にimported_other
      // フォールバックだったが、いまは正しくmenu-1へ解決される)。
      expect(repos.state.visits[0].menuId).toBe('menu-1');
      expect(repos.state.opsLogs).toHaveLength(1);
      expect(repos.state.opsLogs[0].kind).toBe('csv_import');
      // PIIゼロ: ops_logの内容に氏名等が含まれない
      expect(JSON.stringify(repos.state.opsLogs[0].detail)).not.toContain('田中花子');
      // CSV取込ログにメニュー解決の内訳(Pass C)が残る
      expect(result.report.menuResolution.exactMatch).toBe(1);
      expect(result.report.menuResolution.entries).toEqual([
        { rawMenuName: 'カット', resolvedMenuId: 'menu-1', resolvedMenuName: 'カット', resolutionMethod: 'exact_match', occurrenceCount: 1 },
      ]);
      expect(repos.state.opsLogs[0].detail.menuResolution).toEqual(result.report.menuResolution);
    });

    it('既存staff_input来店をCSVで突合してreconciledへ切り替える(会員番号で確定マッチ)', async () => {
      const repos = createFakeRepos();
      const hash = hashExternalKey('C001', 'fixed-test-salt');
      const existingCustomer = await repos.customerRepo.create({
        storeId: STORE_ID, name: '田中花子', ageGroup: null, firstVisitDate: '2026-05-01',
        prefecture: null, city: null, externalKeyHash: hash,
      });
      await repos.visitRepo.create({
        storeId: STORE_ID, customerId: existingCustomer.id, staffId: 'staff-1', menuId: 'menu-1',
        visitDate: '2026-06-01', visitCountAt: 1, isNomination: false, treatmentAmount: 0, retailAmount: 0,
        retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
        noBookingReason: null, voiceMemoUrl: null, visitScore: 0, source: 'staff_input',
      });

      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001', amount: 8000 }),
      ]);
      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      expect(repos.state.visits).toHaveLength(1);
      expect(repos.state.visits[0].source).toBe('reconciled');
      expect(repos.state.visits[0].treatmentAmount).toBe(8000);
    });

    it('実フォーマット(施術行複数+その他の割引行+店販+スタッフ空欄行)からtreatmentAmount/retailAmountを正しく集計してbrain_visitsを作成する', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '施術', subCategory: 'フェイシャル', itemName: 'オプション：毛穴洗浄', amount: 3000, customerName: '田中花子', customerNumber: 'C001' }),
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '施術', subCategory: 'フェイシャル', itemName: 'オプション：ヒト幹細胞導入', amount: 3300, customerName: '田中花子', customerNumber: 'C001' }),
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '店販', subCategory: 'その他', itemName: 'CELCOSクリーム', amount: 11000, customerName: '田中花子', customerNumber: 'C001' }),
        // 割引行はスタッフ列が空欄で出力される(実フォーマット)。会計内の客/スタッフ不一致判定は
        // 空欄を無視するため、この行があってもinconsistent_staffにはならない。
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: 'その他', subCategory: '割引', itemName: 'キャンペーン割引', amount: -1000, staff: '', isDesignatedRaw: '', customerName: '田中花子', customerNumber: 'C001' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      expect(repos.state.visits).toHaveLength(1);
      // 施術2行(3000+3300) + その他/割引1行(-1000) = 5300(店販は含まない)
      expect(repos.state.visits[0].treatmentAmount).toBe(5300);
      expect(repos.state.visits[0].retailAmount).toBe(11000);
      expect(repos.state.visits[0].isNomination).toBe(true);
    });

    it('冪等性: 会員番号ありの同一CSVを複数回投入しても顧客・来店が重複しない', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001' }),
        row({ checkoutId: 'A2', date: '2026-06-02', staff: '鈴木', customerName: '佐藤太郎', customerNumber: 'C002' }),
      ]);

      const first = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);
      const second = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(first.ok && second.ok).toBe(true);
      expect(repos.state.customers).toHaveLength(2);
      expect(repos.state.visits).toHaveLength(2);
      if (second.ok) {
        expect(second.report.newCustomers).toBe(0);
        expect(second.report.visitsImported).toBe(0);
      }
    });

    it('冪等性: 会員番号なし(氏名一致のみ)でも同一CSVの再投入で重複顧客を作らない', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '高橋ゆり' }),
      ]);

      const first = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);
      expect(first.ok).toBe(true);
      expect(repos.state.customers).toHaveLength(1);

      // reviewDecisionsを渡さない2回目の投入(運用上ありがちな「もう一度同じファイルを上げる」操作)
      const second = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.report.newCustomers).toBe(0);
        expect(second.report.updatedCustomers).toBe(1);
        expect(second.report.visitsImported).toBe(0);
      }
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.visits).toHaveLength(1);
    });

    // ── Pass N: CSV重複防止フォールバック③(氏名+初回来店日) ───────────────────
    it('重複防止③: 会員番号なし・同一CSVに同一顧客が異なる日付で2件含まれても重複顧客を作らない', async () => {
      const repos = createFakeRepos();
      // 同一人物(井口悠)が06-06と06-11に来店した2行が同一CSVに存在するケース
      const csv = buildCsv([
        row({ checkoutId: 'N1', date: '2026-06-06', staff: '鈴木', customerName: '井口悠' }),
        row({ checkoutId: 'N2', date: '2026-06-11', staff: '鈴木', customerName: '井口悠' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      // 顧客は1件のみ作成される(重複なし)
      expect(repos.state.customers).toHaveLength(1);
      // 来店は2件(06-06と06-11の各来店)
      expect(repos.state.visits).toHaveLength(2);
      if (result.ok) {
        expect(result.report.newCustomers).toBe(1);
        expect(result.report.updatedCustomers).toBe(1);
        expect(result.report.visitsImported).toBe(2);
      }
    });

    it('重複防止③: 会員番号なし・異なるCSVで同一顧客が別日に来ても重複顧客を作らない(cross-CSV)', async () => {
      const repos = createFakeRepos();
      // 1回目: 鈴木雅子が06-14に来店
      const csv1 = buildCsv([
        row({ checkoutId: 'N3', date: '2026-06-14', staff: '鈴木', customerName: '鈴木雅子' }),
      ]);
      // 2回目: 同一人物が06-17に来店した別CSVを取り込む
      const csv2 = buildCsv([
        row({ checkoutId: 'N4', date: '2026-06-17', staff: '鈴木', customerName: '鈴木雅子' }),
      ]);

      const first = await runImportPipeline({ storeId: STORE_ID, csvText: csv1, reviewDecisions: {} }, repos);
      expect(first.ok).toBe(true);
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.visits).toHaveLength(1);

      const second = await runImportPipeline({ storeId: STORE_ID, csvText: csv2, reviewDecisions: {} }, repos);
      expect(second.ok).toBe(true);
      // 2回目も顧客は増えない
      expect(repos.state.customers).toHaveLength(1);
      // 来店は2件(06-14と06-17)
      expect(repos.state.visits).toHaveLength(2);
      if (second.ok) {
        expect(second.report.newCustomers).toBe(0);
        expect(second.report.updatedCustomers).toBe(1);
        expect(second.report.visitsImported).toBe(1);
      }
    });

    it('重複防止③: 会員番号なし・初回取込で顧客のみ作成(visit=0)されたあと再取込しても重複顧客を作らない', async () => {
      // 鈴木雅子のケース再現: 初回バッチで顧客レコードが作られたがvisitが作られなかった状態
      const repos = createFakeRepos();
      // 初回バッチ: メニュー名不一致でvisitがスキップされた後に顧客だけ残ったシナリオを
      // 直接stateに書き込んで再現する
      repos.state.customers.push({
        id: 'cust-ghost', storeId: STORE_ID, name: '鈴木雅子', ageGroup: null,
        customerType: null, typeConfidence: 0, goalNote: null, weddingDate: null,
        acquisitionChannel: null, firstVisitDate: '2026-06-14', assignedStaffId: null,
        isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
        consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
      });

      // 2回目: 同日付の来店を含むCSVを取り込む
      const csv = buildCsv([
        row({ checkoutId: 'N5', date: '2026-06-14', staff: '鈴木', customerName: '鈴木雅子' }),
      ]);
      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      // 顧客は増えない(cust-ghostのまま)
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.customers[0].id).toBe('cust-ghost');
      // visitが1件作成される
      expect(repos.state.visits).toHaveLength(1);
      if (result.ok) {
        expect(result.report.newCustomers).toBe(0);
        expect(result.report.updatedCustomers).toBe(1);
        expect(result.report.visitsImported).toBe(1);
      }
    });

    it('重複防止④: 予約CSV由来のスタブ顧客(visit=0・firstVisitDate=null)は候補1件ならneeds_reviewに落とさずmatchedとして解決する(docs/CUSTOMER_DUPLICATE_ROOT_CAUSE.md再発防止)', async () => {
      // 小宮山仁美・佐々英之ケースの再現: 予約CSV取込は会計未了の予約から顧客を作るため
      // firstVisitDateを設定しない(reservationImportPipeline.tsの仕様)。この状態のまま
      // 売上明細CSVが同姓同名1件のみを候補として見つけた場合、旧ロジックでは
      // firstVisitDate!=nullを要求するPass Nが発動できずneeds_review→既定'new'で
      // 重複顧客が生成されていた。
      const repos = createFakeRepos();
      repos.state.customers.push({
        id: 'cust-stub', storeId: STORE_ID, name: '小宮山仁美', ageGroup: null,
        customerType: null, typeConfidence: 0, goalNote: null, weddingDate: null,
        acquisitionChannel: null, firstVisitDate: null, assignedStaffId: null,
        isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
        consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
      });

      // Dry Run: needsReviewに出ないことを確認
      const dryRunCsv = buildCsv([
        row({ checkoutId: 'S1', date: '2026-07-22', staff: '鈴木', customerName: '小宮山仁美' }),
      ]);
      const dryRun = await buildDryRunResult({ storeId: STORE_ID, fileName: 'test.csv', csvText: dryRunCsv }, repos);
      expect(dryRun.ok).toBe(true);
      if (dryRun.ok) expect(dryRun.result.needsReview).toHaveLength(0);

      // Import実行: 新規顧客を作らずcust-stubへ確定マッチし、visitのみ追加される
      const result = await runImportPipeline({ storeId: STORE_ID, csvText: dryRunCsv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.customers[0].id).toBe('cust-stub');
      expect(repos.state.visits).toHaveLength(1);
      expect(repos.state.visits[0].customerId).toBe('cust-stub');
      if (result.ok) {
        expect(result.report.newCustomers).toBe(0);
        expect(result.report.updatedCustomers).toBe(1);
        expect(result.report.visitsImported).toBe(1);
      }

      // 監査ログ(brain_ops_logs)にstub_zero_visit_single_candidateの発動件数が記録される
      expect(repos.state.opsLogs).toHaveLength(1);
      expect(repos.state.opsLogs[0].detail.stubResolutionAudit).toEqual({
        reason: 'stub_zero_visit_single_candidate',
        stubZeroVisitMatchedCount: 1,
      });
    });

    it('メニュー名が不一致でフォールバックも無い場合はその会計をスキップする(来店・顧客を作らない)', async () => {
      const repos = createFakeRepos({ menus: [
        { id: 'menu-1', storeId: STORE_ID, name: '全く違うメニュー', price: 5000, role: 'entry', targetTypes: [] },
      ] });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.newCustomers).toBe(0);
      expect(result.report.visitsImported).toBe(0);
      expect(repos.state.customers).toHaveLength(0);
      expect(repos.state.visits).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Pass C: メニュー名名寄せ精度改善(normalizeForMenuMatch/部分一致/代表行選定)
  // ──────────────────────────────────────────────────────────────────────────
  describe('runImportPipeline(Pass C: menuResolver正規化・部分一致)', () => {
    it('全角/空白/大文字小文字の表記ゆれはnormalized_matchで解決する', async () => {
      const repos = createFakeRepos({ menus: [
        { id: 'menu-1', storeId: STORE_ID, name: 'EMSフェイシャル', price: 8000, role: 'entry', targetTypes: [] },
        { id: 'menu-fallback', storeId: STORE_ID, name: 'CSV取込(メニュー名未マッチ)', price: 0, role: 'imported_other', targetTypes: [] },
      ] });
      // 全角スペース入り・小文字ems・前後半角スペース
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001', menu: ' ems　フェイシャル ' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(repos.state.visits[0].menuId).toBe('menu-1');
      expect(result.report.menuResolution.normalizedMatch).toBe(1);
      expect(result.report.menuResolution.entries[0].resolutionMethod).toBe('normalized_match');
    });

    it('部分一致(片方が他方を部分文字列として含む)はpartial_matchで解決する', async () => {
      const repos = createFakeRepos({ menus: [
        { id: 'menu-1', storeId: STORE_ID, name: '毛穴洗浄+ヒト幹19000', price: 19000, role: 'pore', targetTypes: [] },
        { id: 'menu-fallback', storeId: STORE_ID, name: 'CSV取込(メニュー名未マッチ)', price: 0, role: 'imported_other', targetTypes: [] },
      ] });
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001', menu: '毛穴洗浄' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(repos.state.visits[0].menuId).toBe('menu-1');
      expect(result.report.menuResolution.partialMatch).toBe(1);
    });

    it('区分=施術が複数行ある会計は金額最大の行を代表メニュー名として解決する', async () => {
      const repos = createFakeRepos({ menus: [
        { id: 'menu-1', storeId: STORE_ID, name: 'ヒト幹細胞導入', price: 3300, role: 'entry', targetTypes: [] },
        { id: 'menu-fallback', storeId: STORE_ID, name: 'CSV取込(メニュー名未マッチ)', price: 0, role: 'imported_other', targetTypes: [] },
      ] });
      const csv = buildCsv([
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '施術', itemName: '毛穴洗浄', amount: 3000, customerName: '田中花子', customerNumber: 'C001' }),
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '施術', itemName: 'ヒト幹細胞導入', amount: 3300, customerName: '田中花子', customerNumber: 'C001' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 金額最大(3300)の'ヒト幹細胞導入'が代表値として選ばれ、'毛穴洗浄'(3000)は使われない
      expect(repos.state.visits[0].menuId).toBe('menu-1');
      expect(result.report.menuResolution.entries[0].rawMenuName).toBe('ヒト幹細胞導入');
    });

    it('店販・割引のみ(区分=施術/メニュー/オプション/サービスが0件)の会計はmenuName=空文字でfallback_otherになる', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        detailRow({ checkoutId: 'B1', date: '2026/06/01', category: '店販', itemName: 'CELCOSクリーム', amount: 11000, customerName: '田中花子', customerNumber: 'C001' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(repos.state.visits[0].menuId).toBe('menu-fallback');
      expect(result.report.menuResolution.fallbackOther).toBe(1);
      expect(result.report.menuResolution.entries[0].rawMenuName).toBe('');
    });

    it('同一メニュー名が複数会計に出現してもops_logsの内訳エントリは1件に集約され、occurrenceCountが加算される', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '田中花子', customerNumber: 'C001', menu: 'カット' }),
        row({ checkoutId: 'A2', date: '2026-06-02', staff: '鈴木', customerName: '佐藤太郎', customerNumber: 'C002', menu: 'カット' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.menuResolution.entries).toHaveLength(1);
      expect(result.report.menuResolution.entries[0]).toMatchObject({ rawMenuName: 'カット', occurrenceCount: 2 });
      expect(result.report.menuResolution.exactMatch).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Pass D: CSV Import完成(顧客/スタッフ名寄せ精度検証・ImportReport不足項目修正・品質レポート)
  // ──────────────────────────────────────────────────────────────────────────
  describe('runImportPipeline(Pass D: 顧客名寄せ精度・ImportReport・品質レポート)', () => {
    it('Pass N修正後: 会員番号なし+reviewDecisions未指定でも同一人物の複数来店が重複顧客を作らない(氏名+初回来店日フォールバック)', async () => {
      // Pass Dでは「複数の顧客レコードに分裂する」既知リスクとして記録していたが、
      // Pass Nでフォールバック③(氏名+初回来店日)を実装したことにより修正された。
      // 1件目でcustomer作成→2件目以降はfirstVisitDate≤visitDateで auto-matchされる。
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '中村陽子' }),
        row({ checkoutId: 'A2', date: '2026-06-08', staff: '鈴木', customerName: '中村陽子' }),
        row({ checkoutId: 'A3', date: '2026-06-15', staff: '鈴木', customerName: '中村陽子' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Pass N修正: 1顧客・3来店として正しく取り込まれる
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.customers[0].name).toBe('中村陽子');
      expect(result.report.newCustomers).toBe(1);
      expect(result.report.updatedCustomers).toBe(2);
      expect(result.report.visitsImported).toBe(3);
      // qualityReportはCSV行から計算するため引き続き重複名を警告する(運用者への注意喚起)
      expect(result.report.qualityReport.duplicateCustomerNames).toEqual([{ name: '中村陽子', occurrenceCount: 3 }]);
      expect(result.report.qualityReport.warnings).toContainEqual(
        expect.objectContaining({ type: 'duplicate_customer_name', count: 1 })
      );
    });

    it('reviewDecisionsで明示的にmergeを指定すれば重複顧客を作らずに1件へ統合できる(運用者の確認が前提)', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '中村陽子' }),
        row({ checkoutId: 'A2', date: '2026-06-08', staff: '鈴木', customerName: '中村陽子' }),
      ]);

      // 1行目(lineNumber=2)はnew、2行目(lineNumber=3)はneeds_review→merge指定
      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: { 3: 'merge' } }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(repos.state.customers).toHaveLength(1);
      expect(result.report.newCustomers).toBe(1);
      expect(result.report.updatedCustomers).toBe(1);
    });

    it('ImportReportにunresolvedStaffCountが含まれる(以前はops_logsのみで欠落していたバグの修正)', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '未知のスタッフ', customerName: '田中花子', customerNumber: 'C001' }),
        row({ checkoutId: 'A2', date: '2026-06-02', staff: '鈴木', customerName: '佐藤太郎', customerNumber: 'C002' }),
      ]);

      const result = await runImportPipeline({ storeId: STORE_ID, csvText: csv, reviewDecisions: {} }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.unresolvedStaffCount).toBe(1);
      expect(repos.state.opsLogs[0].detail.unresolvedStaffCount).toBe(1);
      expect(result.report.qualityReport.warnings).toContainEqual(
        expect.objectContaining({ type: 'unresolved_staff', count: 1, severity: 'error' })
      );
    });

    it('buildDryRunResultもqualityReportを返す(Import実行前にリスクを確認できる)', async () => {
      const repos = createFakeRepos();
      const csv = buildCsv([
        row({ checkoutId: 'A1', date: '2026-06-01', staff: '鈴木', customerName: '中村陽子' }),
        row({ checkoutId: 'A2', date: '2026-06-08', staff: '鈴木', customerName: '中村陽子' }),
      ]);

      const result = await buildDryRunResult({ storeId: STORE_ID, fileName: 'test.csv', csvText: csv }, repos);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.qualityReport.duplicateCustomerNames).toEqual([{ name: '中村陽子', occurrenceCount: 2 }]);
      // dry-runはDBに何も書込まない(既存方針を維持していることの確認)
      expect(repos.state.customers).toHaveLength(0);
    });
  });
});

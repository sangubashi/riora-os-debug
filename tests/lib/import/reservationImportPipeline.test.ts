// ================================================================
// reservationImportPipeline 検証
//
// PHASE actor_id是正: brain_ops_logs.actor_id(kind='reservation_csv_import')が
// 常にnullで記録されていた問題の是正確認。ImportInput.actorIdがopsLogへ
// 正しく伝播すること(指定時はその値、省略時はnull)を検証する。
// あわせて、SupabaseもICustomerRepo等もin-memory fakeで最小限のpipeline
// 動作(新規顧客+予約の作成)も確認する。
//
// 本テストが新設されるまでreservationImportPipeline.tsに専用テストが
// 存在しなかったため、csvImportPipeline.test.tsと同じ方針(I*Repoの
// in-memory fake)で最小限のカバレッジを用意する。
// ================================================================
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runReservationImportPipeline,
  type ReservationPipelineRepos,
} from '../../../src/lib/import/reservationImportPipeline';
import type { Customer, OpsLog, Staff } from '../../../src/types/riora.types';
import type { ReservationRow, ReservationUpsertInput } from '../../../src/repositories/interfaces';

const STORE_ID = 'store-1';

const HEADER = 'ステータス,スタッフ名,来店日,開始時間,終了時間,所要時間,フリガナ,お名前,予約時合計金額';

function row(opts: {
  status?:  string;
  staff?:   string;
  date?:    string;
  start?:   string;
  end?:     string;
  duration?: number;
  kana?:    string;
  name:     string;
  amount?:  number;
}): string {
  const {
    status = '受付待ち', staff = '鈴木', date = '20260601',
    start = '1000', end = '1100', duration = 60, kana = '', name, amount = 5000,
  } = opts;
  return [status, staff, date, start, end, duration, kana, name, amount].join(',');
}

function buildCsv(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

// ─── in-memory fake repos + fake supabase(brain_staff.user_id解決専用) ────────

function createFakeRepos(opts: { staff?: Staff[] } = {}): ReservationPipelineRepos & { state: {
  customers: Customer[];
  reservations: Array<{ id: string; input: ReservationUpsertInput; cancelSource?: 'manual' | 'salonboard_csv' | null }>;
  opsLogs: OpsLog[];
} } {
  const staff: Staff[] = opts.staff ?? [
    { id: 'staff-1', storeId: STORE_ID, name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] },
  ];

  const state = {
    customers:    [] as Customer[],
    reservations: [] as Array<{ id: string; input: ReservationUpsertInput; cancelSource?: 'manual' | 'salonboard_csv' | null }>,
    opsLogs:      [] as OpsLog[],
  };
  let customerSeq = 0;
  let reservationSeq = 0;

  const repos: ReservationPipelineRepos = {
    customerRepo: {
      findById: async (id) => state.customers.find(c => c.id === id) ?? null,
      listByStore: async () => [...state.customers],
      findByExternalKeyHash: async () => null,
      create: async (input) => {
        customerSeq += 1;
        const created: Customer = {
          id: `cust-${customerSeq}`,
          storeId: input.storeId,
          name: input.name,
          nameKana: input.nameKana ?? null,
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
      patchFromImport: async () => { throw new Error('not implemented in test fake'); },
      updateCustomerType: async () => { throw new Error('not implemented in test fake'); },
      // PERF-KANA-BACKFILL-2: CustomerRepo.backfillNameKana(本番実装)と同じく、
      // name_kanaが未登録(null/空文字)の顧客のみ更新する(冪等・既存値は上書きしない)。
      backfillNameKana: async (id, nameKana) => {
        const c = state.customers.find(x => x.id === id);
        if (!c || (c.nameKana && c.nameKana !== '')) return;
        c.nameKana = nameKana;
      },
    },
    staffRepo: {
      listByStore: async () => staff,
      addNameAlias: async () => null,
      deactivate: async () => null,
      create: async () => { throw new Error('not implemented in test fake'); },
    },
    reservationRepo: {
      findByNaturalKey: async (scheduledAt, brainCustomerId) => {
        const found = state.reservations.find(
          r => r.input.scheduledAt === scheduledAt && r.input.brainCustomerId === brainCustomerId
        );
        return found ? { id: found.id, cancelSource: found.cancelSource ?? null } as ReservationRow : null;
      },
      create: async (input) => {
        reservationSeq += 1;
        const id = `res-${reservationSeq}`;
        state.reservations.push({ id, input });
        return { id };
      },
      update: async (id, input) => {
        const r = state.reservations.find(x => x.id === id);
        if (r) r.input = input;
      },
      weeklySummary: async () => { throw new Error('not implemented in test fake'); },
    },
    opsLogRepo: {
      insert: async (log) => {
        const created: OpsLog = { ...log, id: `log-${state.opsLogs.length + 1}`, createdAt: new Date().toISOString() };
        state.opsLogs.push(created);
        return created;
      },
      recentByStoreAndKind: async (storeId, kind, n) =>
        state.opsLogs.filter(l => l.storeId === storeId && l.kind === kind).slice(0, n),
      recentByStoreAndKindPrefix: async (storeId, kindPrefix, n) =>
        state.opsLogs.filter(l => l.storeId === storeId && l.kind.startsWith(kindPrefix)).slice(0, n),
    },
  };

  return { ...repos, state };
}

/** buildStaffProfileMap()が投げる唯一のクエリ(brain_staff.id/user_id)だけを fake する。 */
function createFakeSupabase(staffProfiles: Array<{ id: string; user_id: string }>): SupabaseClient {
  const fake = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          is: async (_col2: string, _val2: null) => ({ data: staffProfiles, error: null }),
        }),
      }),
    }),
  };
  return fake as unknown as SupabaseClient;
}

describe('reservationImportPipeline', () => {
  describe('runReservationImportPipeline', () => {
    it('新規顧客+予約を作成する(基本動作)', async () => {
      const repos = createFakeRepos();
      const supabase = createFakeSupabase([{ id: 'staff-1', user_id: 'profile-1' }]);
      const csv = buildCsv([row({ name: '田中花子' })]);

      const result = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: csv, reviewDecisions: {} },
        repos,
        supabase
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.created).toBe(1);
      expect(result.report.updated).toBe(0);
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.reservations).toHaveLength(1);
      expect(repos.state.reservations[0].input.staffId).toBe('profile-1');
    });

    it('PERF-KANA-BACKFILL-2: 新規顧客作成時、CSVの「フリガナ」列がname_kanaとして保存される(予約のみのスタブ顧客対応)', async () => {
      const repos = createFakeRepos();
      const supabase = createFakeSupabase([{ id: 'staff-1', user_id: 'profile-1' }]);
      const csv = buildCsv([row({ name: '黒田 和正', kana: 'クロダ カズマサ' })]);

      const result = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: csv, reviewDecisions: {} },
        repos,
        supabase
      );

      expect(result.ok).toBe(true);
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.customers[0].nameKana).toBe('クロダ カズマサ');
    });

    it('PERF-KANA-BACKFILL-2: 既存顧客(氏名一致でmatched)のname_kanaが未登録の場合、CSVのフリガナでバックフィルされる', async () => {
      const repos = createFakeRepos();
      repos.state.customers.push({
        id: 'cust-existing', storeId: STORE_ID, name: '黒田 和正', nameKana: null, ageGroup: null, customerType: null,
        typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
        firstVisitDate: null, assignedStaffId: null, isSubscriber: false, subscribedAt: null,
        churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
        prefecture: null, city: null, externalKeyHash: null,
      });
      const supabase = createFakeSupabase([{ id: 'staff-1', user_id: 'profile-1' }]);
      const csv = buildCsv([row({ name: '黒田 和正', kana: 'クロダ カズマサ' })]);

      const result = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: csv, reviewDecisions: {} },
        repos,
        supabase
      );

      expect(result.ok).toBe(true);
      expect(repos.state.customers).toHaveLength(1);
      expect(repos.state.customers[0].nameKana).toBe('クロダ カズマサ');
    });

    // ── 当日キャンセル機能(2026-10-01): 手動キャンセルのCSV上書き保護 ──────────────────
    async function importTwice(secondCsvStatus: string, markManualCancelled: boolean) {
      const repos = createFakeRepos();
      const supabase = createFakeSupabase([{ id: 'staff-1', user_id: 'profile-1' }]);
      const first = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: buildCsv([row({ name: '田中花子' })]), reviewDecisions: {} },
        repos, supabase
      );
      expect(first.ok).toBe(true);
      expect(repos.state.reservations).toHaveLength(1);

      if (markManualCancelled) {
        // /karteでの手動キャンセル後の状態(status=cancelled, cancel_source=manual)を再現する。
        repos.state.reservations[0].input = { ...repos.state.reservations[0].input, status: 'cancelled' };
        repos.state.reservations[0].cancelSource = 'manual';
      }

      const second = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: buildCsv([row({ name: '田中花子', status: secondCsvStatus })]), reviewDecisions: {} },
        repos, supabase
      );
      return { repos, second };
    }

    it('手動キャンセル(cancel_source=manual)の予約は、CSVが予約済み(受付待ち)のままでも復活しない', async () => {
      const { repos, second } = await importTwice('受付待ち', true);

      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.updated).toBe(0);
      expect(second.report.created).toBe(0);
      expect(repos.state.reservations).toHaveLength(1);
      expect(repos.state.reservations[0].input.status).toBe('cancelled');
    });

    it('手動キャンセルの保護はCSV上のstatusに関わらず働く(会計済みでも自動復活しない)', async () => {
      const { repos } = await importTwice('会計済み', true);
      expect(repos.state.reservations[0].input.status).toBe('cancelled');
    });

    it('手動キャンセルを保護した場合、ops_logに manualCancelProtected(行番号とCSV上のstatusのみ・個人情報なし)が残る', async () => {
      const { repos } = await importTwice('受付待ち', true);

      const secondLog = repos.state.opsLogs[1];
      expect(secondLog.detail.manualCancelProtectedCount).toBe(1);
      expect(secondLog.detail.manualCancelProtected).toEqual([{ rowNumber: 2, csvStatus: 'confirmed' }]);
      // 1回目(保護なし)のログには項目自体が付かない
      expect(repos.state.opsLogs[0].detail.manualCancelProtected).toBeUndefined();
    });

    it('手動キャンセルでない予約(cancel_source未設定)は従来どおりCSVの内容で更新される', async () => {
      const { repos, second } = await importTwice('お客様キャンセル', false);

      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.updated).toBe(1);
      expect(repos.state.reservations[0].input.status).toBe('cancelled');
    });

    it('actorIdを指定した場合、brain_ops_logsのactorIdにその値が入る', async () => {
      const repos = createFakeRepos();
      const supabase = createFakeSupabase([{ id: 'staff-1', user_id: 'profile-1' }]);
      const csv = buildCsv([row({ name: '田中花子' })]);

      const result = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: csv, reviewDecisions: {}, actorId: 'auth-user-123' },
        repos,
        supabase
      );

      expect(result.ok).toBe(true);
      expect(repos.state.opsLogs).toHaveLength(1);
      expect(repos.state.opsLogs[0].kind).toBe('reservation_csv_import');
      expect(repos.state.opsLogs[0].actorId).toBe('auth-user-123');
    });

    it('actorIdを省略した場合、brain_ops_logsのactorIdはnullになる', async () => {
      const repos = createFakeRepos();
      const supabase = createFakeSupabase([{ id: 'staff-1', user_id: 'profile-1' }]);
      const csv = buildCsv([row({ name: '田中花子' })]);

      const result = await runReservationImportPipeline(
        { storeId: STORE_ID, csvText: csv, reviewDecisions: {} },
        repos,
        supabase
      );

      expect(result.ok).toBe(true);
      expect(repos.state.opsLogs).toHaveLength(1);
      expect(repos.state.opsLogs[0].actorId).toBeNull();
    });
  });
});

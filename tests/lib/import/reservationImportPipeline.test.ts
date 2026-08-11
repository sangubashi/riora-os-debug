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

const HEADER = 'ステータス,スタッフ名,来店日,開始時間,終了時間,所要時間,お名前,予約時合計金額';

function row(opts: {
  status?:  string;
  staff?:   string;
  date?:    string;
  start?:   string;
  end?:     string;
  duration?: number;
  name:     string;
  amount?:  number;
}): string {
  const {
    status = '受付待ち', staff = '鈴木', date = '20260601',
    start = '1000', end = '1100', duration = 60, name, amount = 5000,
  } = opts;
  return [status, staff, date, start, end, duration, name, amount].join(',');
}

function buildCsv(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

// ─── in-memory fake repos + fake supabase(brain_staff.user_id解決専用) ────────

function createFakeRepos(opts: { staff?: Staff[] } = {}): ReservationPipelineRepos & { state: {
  customers: Customer[];
  reservations: Array<{ id: string; input: ReservationUpsertInput }>;
  opsLogs: OpsLog[];
} } {
  const staff: Staff[] = opts.staff ?? [
    { id: 'staff-1', storeId: STORE_ID, name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] },
  ];

  const state = {
    customers:    [] as Customer[],
    reservations: [] as Array<{ id: string; input: ReservationUpsertInput }>,
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
        return found ? { id: found.id } as ReservationRow : null;
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

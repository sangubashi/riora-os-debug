import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VisitRepo } from '../../../src/repositories/supabase/VisitRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainVisitRow } from '../../../src/repositories/supabase/mappers';
import type { Visit } from '../../../src/types/riora.types';

/** .rpc()のみ使うテスト用モック(既存testUtilsの.from()系ヘルパーは.rpc()を持たないため個別に用意)。 */
function createRpcSupabaseMock(result: { data: unknown; error: { message: string } | null }): {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const single = vi.fn(() => Promise.resolve(result));
  const rpc = vi.fn(() => ({ single }));
  const client = { rpc } as unknown as SupabaseClient;
  return { client, rpc };
}

const VISIT_ROW: BrainVisitRow = {
  id: 'visit-1',
  store_id: 'store-1',
  customer_id: 'cust-1',
  staff_id: 'staff-1',
  menu_id: 'menu-1',
  visit_date: '2026-06-01',
  visit_count_at: 3,
  is_nomination: true,
  treatment_amount: 8000,
  retail_amount: 2000,
  retail_category: 'shampoo',
  homecare_purchased: true,
  homecare_declined: false,
  next_booking_made: true,
  no_booking_reason: null,
  voice_memo_url: null,
  visit_score: 0.75,
};

describe('VisitRepo', () => {
  describe('recentByCustomer', () => {
    it('customer_idに紐づく訪問をVisit[]へ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [VISIT_ROW], error: null });
      const repo = new VisitRepo(client);

      const result = await repo.recentByCustomer('cust-1', 5);

      expect(result).toEqual([
        {
          id: 'visit-1',
          storeId: 'store-1',
          customerId: 'cust-1',
          staffId: 'staff-1',
          menuId: 'menu-1',
          visitDate: '2026-06-01',
          visitCountAt: 3,
          isNomination: true,
          treatmentAmount: 8000,
          retailAmount: 2000,
          retailCategory: 'shampoo',
          homecarePurchased: true,
          homecareDeclined: false,
          nextBookingMade: true,
          noBookingReason: null,
          voiceMemoUrl: null,
          visitScore: 0.75,
        },
      ]);
    });

    it('dataがnullの場合は空配列を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new VisitRepo(client);

      const result = await repo.recentByCustomer('cust-1', 5);

      expect(result).toEqual([]);
    });

    it('Supabaseがerrorを返した場合はVisitRepo.recentByCustomer failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new VisitRepo(client);

      await expect(repo.recentByCustomer('cust-1', 5)).rejects.toThrow(
        'VisitRepo.recentByCustomer failed: db down'
      );
    });

    it('customer_id・deleted_at IS NULL・visit_date降順・limit nで取得する', async () => {
      const builder = createQueryBuilderMock({ data: [VISIT_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new VisitRepo(client);

      await repo.recentByCustomer('cust-1', 5);

      expect(builder.eq).toHaveBeenCalledWith('customer_id', 'cust-1');
      expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
      expect(builder.order).toHaveBeenCalledWith('visit_date', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('create', () => {
    const newVisit: Omit<Visit, 'id'> = {
      storeId: 'store-1',
      customerId: 'cust-1',
      staffId: 'staff-1',
      menuId: 'menu-1',
      visitDate: '2026-06-01',
      visitCountAt: 3,
      isNomination: true,
      treatmentAmount: 8000,
      retailAmount: 2000,
      retailCategory: 'shampoo',
      homecarePurchased: true,
      homecareDeclined: false,
      nextBookingMade: true,
      noBookingReason: null,
      voiceMemoUrl: null,
      visitScore: 0.75,
    };

    it('挿入された行をVisitへ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: VISIT_ROW, error: null });
      const repo = new VisitRepo(client);

      const result = await repo.create(newVisit);

      expect(result.id).toBe('visit-1');
      expect(result.customerId).toBe('cust-1');
      expect(result.visitScore).toBe(0.75);
    });

    it('Supabaseがerrorを返した場合はVisitRepo.create failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'insert failed' } });
      const repo = new VisitRepo(client);

      await expect(repo.create(newVisit)).rejects.toThrow('VisitRepo.create failed: insert failed');
    });

    it('camelCaseのVisitをsnake_caseのinsert行へ変換して渡す', async () => {
      const builder = createQueryBuilderMock({ data: VISIT_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new VisitRepo(client);

      await repo.create(newVisit);

      expect(builder.insert).toHaveBeenCalledWith({
        store_id: 'store-1',
        customer_id: 'cust-1',
        staff_id: 'staff-1',
        menu_id: 'menu-1',
        visit_date: '2026-06-01',
        visit_count_at: 3,
        is_nomination: true,
        treatment_amount: 8000,
        retail_amount: 2000,
        retail_category: 'shampoo',
        homecare_purchased: true,
        homecare_declined: false,
        next_booking_made: true,
        no_booking_reason: null,
        voice_memo_url: null,
        visit_score: 0.75,
      });
    });
  });

  describe('createSequenced', () => {
    const newSequencedVisit: Omit<Visit, 'id' | 'visitCountAt'> = {
      storeId: 'store-1',
      customerId: 'cust-1',
      staffId: 'staff-1',
      menuId: 'menu-1',
      visitDate: '2026-06-01',
      isNomination: true,
      treatmentAmount: 8000,
      retailAmount: 2000,
      retailCategory: 'shampoo',
      homecarePurchased: true,
      homecareDeclined: false,
      nextBookingMade: true,
      noBookingReason: null,
      voiceMemoUrl: null,
      visitScore: 0.75,
      source: 'salonboard_import',
    };

    it('rpc(insert_visit_with_sequence)を呼び出す', async () => {
      const { client, rpc } = createRpcSupabaseMock({ data: VISIT_ROW, error: null });
      const repo = new VisitRepo(client);

      await repo.createSequenced(newSequencedVisit);

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0][0]).toBe('insert_visit_with_sequence');
    });

    it('p_store_id〜p_sourceをRPC引数として正しく渡す', async () => {
      const { client, rpc } = createRpcSupabaseMock({ data: VISIT_ROW, error: null });
      const repo = new VisitRepo(client);

      await repo.createSequenced(newSequencedVisit);

      expect(rpc).toHaveBeenCalledWith('insert_visit_with_sequence', {
        p_store_id: 'store-1',
        p_customer_id: 'cust-1',
        p_staff_id: 'staff-1',
        p_menu_id: 'menu-1',
        p_visit_date: '2026-06-01',
        p_is_nomination: true,
        p_treatment_amount: 8000,
        p_retail_amount: 2000,
        p_retail_category: 'shampoo',
        p_homecare_purchased: true,
        p_homecare_declined: false,
        p_next_booking_made: true,
        p_no_booking_reason: null,
        p_voice_memo_url: null,
        p_visit_score: 0.75,
        p_source: 'salonboard_import',
      });
    });

    it('visitCountAtに相当する引数をRPCへ渡さない(DB側のみで採番する)', async () => {
      const { client, rpc } = createRpcSupabaseMock({ data: VISIT_ROW, error: null });
      const repo = new VisitRepo(client);

      await repo.createSequenced(newSequencedVisit);

      const args = rpc.mock.calls[0][1] as Record<string, unknown>;
      expect(args).not.toHaveProperty('visit_count_at');
      expect(args).not.toHaveProperty('visitCountAt');
      expect(args).not.toHaveProperty('p_visit_count_at');
    });

    it('sourceを省略した場合はstaff_inputを既定値として渡す', async () => {
      const { client, rpc } = createRpcSupabaseMock({ data: VISIT_ROW, error: null });
      const repo = new VisitRepo(client);
      const { source: _source, ...visitWithoutSource } = newSequencedVisit;
      void _source;

      await repo.createSequenced(visitWithoutSource);

      expect(rpc.mock.calls[0][1]).toMatchObject({ p_source: 'staff_input' });
    });

    it('Supabaseがerrorを返した場合はFailed to create sequenced visitで例外を投げる', async () => {
      const { client } = createRpcSupabaseMock({ data: null, error: { message: 'lock timeout' } });
      const repo = new VisitRepo(client);

      await expect(repo.createSequenced(newSequencedVisit)).rejects.toThrow(
        'Failed to create sequenced visit: lock timeout'
      );
    });

    it('正常時はRPC戻り値をVisit型へ変換して返す', async () => {
      const { client } = createRpcSupabaseMock({ data: VISIT_ROW, error: null });
      const repo = new VisitRepo(client);

      const result = await repo.createSequenced(newSequencedVisit);

      expect(result.id).toBe('visit-1');
      expect(result.customerId).toBe('cust-1');
      // VISIT_ROW.visit_count_at(=3)はDB側(RPC)で決定された値であり、呼び出し側は渡していない。
      expect(result.visitCountAt).toBe(3);
    });
  });

  describe('countByCustomer', () => {
    it('該当する訪問件数を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null, count: 3 });
      const repo = new VisitRepo(client);

      const result = await repo.countByCustomer('cust-1');

      expect(result).toBe(3);
    });

    it('countがnullの場合は0を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null, count: null });
      const repo = new VisitRepo(client);

      const result = await repo.countByCustomer('cust-1');

      expect(result).toBe(0);
    });

    it('Supabaseがerrorを返した場合はVisitRepo.countByCustomer failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'count failed' } });
      const repo = new VisitRepo(client);

      await expect(repo.countByCustomer('cust-1')).rejects.toThrow('VisitRepo.countByCustomer failed: count failed');
    });

    it('customer_id・deleted_at IS NULLでcount付きhead取得する', async () => {
      const builder = createQueryBuilderMock({ data: null, error: null, count: 3 });
      const client = createSupabaseMock(() => builder);
      const repo = new VisitRepo(client);

      await repo.countByCustomer('cust-1');

      expect(builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
      expect(builder.eq).toHaveBeenCalledWith('customer_id', 'cust-1');
      expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  describe('sumSalesByStoreAndDate', () => {
    it('treatment_amount+retail_amountの合計を返す', async () => {
      const { client } = createSingleTableSupabaseMock({
        data: [
          { treatment_amount: 8000, retail_amount: 2000 },
          { treatment_amount: 5000, retail_amount: 0 },
        ],
        error: null,
      });
      const repo = new VisitRepo(client);

      const result = await repo.sumSalesByStoreAndDate('store-1', '2026-06-22');

      expect(result).toBe(15000);
    });

    it('該当する訪問が無い場合は0を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new VisitRepo(client);

      const result = await repo.sumSalesByStoreAndDate('store-1', '2026-06-22');

      expect(result).toBe(0);
    });

    it('Supabaseがerrorを返した場合はVisitRepo.sumSalesByStoreAndDate failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new VisitRepo(client);

      await expect(repo.sumSalesByStoreAndDate('store-1', '2026-06-22'))
        .rejects.toThrow('VisitRepo.sumSalesByStoreAndDate failed: db down');
    });

    it('store_id・visit_date・deleted_at IS NULLでフィルタする', async () => {
      const builder = createQueryBuilderMock({ data: [], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new VisitRepo(client);

      await repo.sumSalesByStoreAndDate('store-1', '2026-06-22');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.eq).toHaveBeenCalledWith('visit_date', '2026-06-22');
      expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  describe('updateNextBookingMade', () => {
    it('next_booking_madeをid指定で更新する', async () => {
      const builder = createQueryBuilderMock({ data: null, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new VisitRepo(client);

      await repo.updateNextBookingMade('visit-1', true);

      expect(builder.update).toHaveBeenCalledWith({ next_booking_made: true });
      expect(builder.eq).toHaveBeenCalledWith('id', 'visit-1');
    });

    it('Supabaseがerrorを返した場合はVisitRepo.updateNextBookingMade failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'update failed' } });
      const repo = new VisitRepo(client);

      await expect(repo.updateNextBookingMade('visit-1', false)).rejects.toThrow(
        'VisitRepo.updateNextBookingMade failed: update failed'
      );
    });
  });

  describe('listByStore', () => {
    it('store_idに紐づく全訪問をvisit_date昇順でVisit[]へ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [VISIT_ROW], error: null });
      const repo = new VisitRepo(client);

      const result = await repo.listByStore('store-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('visit-1');
    });

    it('store_id・deleted_at IS NULLでフィルタしvisit_date昇順で取得する', async () => {
      const builder = createQueryBuilderMock({ data: [], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new VisitRepo(client);

      await repo.listByStore('store-1');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
      expect(builder.order).toHaveBeenCalledWith('visit_date', { ascending: true });
    });

    it('Supabaseがerrorを返した場合はVisitRepo.listByStore failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new VisitRepo(client);

      await expect(repo.listByStore('store-1')).rejects.toThrow('VisitRepo.listByStore failed: db down');
    });
  });
});

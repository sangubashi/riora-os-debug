import { describe, expect, it } from 'vitest';
import { VisitRepo } from '../../../src/repositories/supabase/VisitRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainVisitRow } from '../../../src/repositories/supabase/mappers';
import type { Visit } from '../../../src/types/riora.types';

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
});

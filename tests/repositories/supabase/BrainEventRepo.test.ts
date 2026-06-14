import { describe, expect, it } from 'vitest';
import { BrainEventRepo } from '../../../src/repositories/supabase/BrainEventRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainEventRow } from '../../../src/repositories/supabase/mappers';
import type { BrainEvent } from '../../../src/types/brain.types';

const EVENT_ROW: BrainEventRow = {
  id: 'event-1',
  store_anon_id: 'store-anon-1',
  customer_hash: 'hash-1',
  event_type: 'visit',
  customer_type: 'B_pore',
  staff_style: 'empathy',
  proposal_kind: 'homecare',
  was_accepted: true,
  occurred_on: '2026-06-01',
  visit_count_at: 3,
  amount_band: '1000-2000',
  payload: { visitScore: 0.8, skinImproved: true, retailAmountBand: '1000-2000' },
};

const NEW_EVENT: Omit<BrainEvent, 'id'> = {
  storeAnonId: 'store-anon-1',
  customerHash: 'hash-1',
  eventType: 'visit',
  customerType: 'B_pore',
  staffStyle: 'empathy',
  proposalKind: 'homecare',
  wasAccepted: true,
  occurredOn: '2026-06-01',
  visitCountAt: 3,
  amountBand: '1000-2000',
  payload: { visitScore: 0.8, skinImproved: true, retailAmountBand: '1000-2000' },
};

describe('BrainEventRepo', () => {
  describe('insert', () => {
    it('挿入された行をBrainEventへ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: EVENT_ROW, error: null });
      const repo = new BrainEventRepo(client);

      const result = await repo.insert(NEW_EVENT);

      expect(result).toEqual({
        id: 'event-1',
        storeAnonId: 'store-anon-1',
        customerHash: 'hash-1',
        eventType: 'visit',
        customerType: 'B_pore',
        staffStyle: 'empathy',
        proposalKind: 'homecare',
        wasAccepted: true,
        occurredOn: '2026-06-01',
        visitCountAt: 3,
        amountBand: '1000-2000',
        payload: { visitScore: 0.8, skinImproved: true, retailAmountBand: '1000-2000' },
      });
    });

    it('Supabaseがerrorを返した場合はBrainEventRepo.insert failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'insert failed' } });
      const repo = new BrainEventRepo(client);

      await expect(repo.insert(NEW_EVENT)).rejects.toThrow('BrainEventRepo.insert failed: insert failed');
    });

    it('camelCaseのBrainEventをsnake_caseのinsert行へ変換して渡す', async () => {
      const builder = createQueryBuilderMock({ data: EVENT_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BrainEventRepo(client);

      await repo.insert(NEW_EVENT);

      expect(builder.insert).toHaveBeenCalledWith({
        store_anon_id: 'store-anon-1',
        customer_hash: 'hash-1',
        event_type: 'visit',
        customer_type: 'B_pore',
        staff_style: 'empathy',
        proposal_kind: 'homecare',
        was_accepted: true,
        occurred_on: '2026-06-01',
        visit_count_at: 3,
        amount_band: '1000-2000',
        payload: { visitScore: 0.8, skinImproved: true, retailAmountBand: '1000-2000' },
      });
    });
  });

  describe('recentByType', () => {
    it('event_type + customer_typeに紐づく行をBrainEvent[]へ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [EVENT_ROW], error: null });
      const repo = new BrainEventRepo(client);

      const result = await repo.recentByType('visit', 'B_pore', 10);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-1');
      expect(result[0].eventType).toBe('visit');
    });

    it('dataがnullの場合は空配列を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new BrainEventRepo(client);

      const result = await repo.recentByType('visit', 'B_pore', 10);

      expect(result).toEqual([]);
    });

    it('Supabaseがerrorを返した場合はBrainEventRepo.recentByType failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'timeout' } });
      const repo = new BrainEventRepo(client);

      await expect(repo.recentByType('visit', 'B_pore', 10)).rejects.toThrow(
        'BrainEventRepo.recentByType failed: timeout'
      );
    });

    it('event_type・customer_typeでフィルタしoccurred_on降順・limit nで取得する', async () => {
      const builder = createQueryBuilderMock({ data: [EVENT_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BrainEventRepo(client);

      await repo.recentByType('proposal_outcome', 'A_acne', 7);

      expect(builder.eq).toHaveBeenCalledWith('event_type', 'proposal_outcome');
      expect(builder.eq).toHaveBeenCalledWith('customer_type', 'A_acne');
      expect(builder.order).toHaveBeenCalledWith('occurred_on', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(7);
    });
  });
});

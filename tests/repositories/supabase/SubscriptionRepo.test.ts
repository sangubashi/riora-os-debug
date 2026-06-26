import { describe, expect, it } from 'vitest';
import { SubscriptionRepo } from '../../../src/repositories/supabase/SubscriptionRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainSubscriptionRow } from '../../../src/repositories/supabase/mappers';

const SUBSCRIPTION_ROW: BrainSubscriptionRow = {
  id: 'sub-1',
  store_id: 'store-1',
  customer_id: 'cust-1',
  plan_name: '月額ケアプラン',
  monthly_price: 8000,
  started_at: '2026-01-01',
  cancelled_at: null,
  cancel_reason: null,
};

describe('SubscriptionRepo', () => {
  describe('listByStore', () => {
    it('store_idに紐づくサブスクをSubscription[]へ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [SUBSCRIPTION_ROW], error: null });
      const repo = new SubscriptionRepo(client);

      const result = await repo.listByStore('store-1');

      expect(result).toEqual([
        {
          id: 'sub-1',
          storeId: 'store-1',
          customerId: 'cust-1',
          planName: '月額ケアプラン',
          monthlyPrice: 8000,
          startedAt: '2026-01-01',
          cancelledAt: null,
          cancelReason: null,
        },
      ]);
    });

    it('dataがnullの場合は空配列を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new SubscriptionRepo(client);

      const result = await repo.listByStore('store-1');

      expect(result).toEqual([]);
    });

    it('store_id・deleted_at IS NULLでフィルタする', async () => {
      const builder = createQueryBuilderMock({ data: [], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new SubscriptionRepo(client);

      await repo.listByStore('store-1');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
    });

    it('Supabaseがerrorを返した場合はSubscriptionRepo.listByStore failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new SubscriptionRepo(client);

      await expect(repo.listByStore('store-1')).rejects.toThrow('SubscriptionRepo.listByStore failed: db down');
    });
  });
});

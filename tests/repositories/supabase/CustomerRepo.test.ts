import { describe, expect, it } from 'vitest';
import { CustomerRepo } from '../../../src/repositories/supabase/CustomerRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainCustomerRow } from '../../../src/repositories/supabase/mappers';

const CUSTOMER_ROW: BrainCustomerRow = {
  id: 'cust-1',
  store_id: 'store-1',
  name: '山田花子',
  age_group: '30s',
  customer_type: 'B_pore',
  type_confidence: '0.8',
  goal_note: '毛穴改善したい',
  wedding_date: null,
  acquisition_channel: 'hotpepper',
  first_visit_date: '2026-01-10',
  assigned_staff_id: 'staff-1',
  is_subscriber: true,
  subscribed_at: '2026-02-01T00:00:00Z',
  churn_score: '0.12',
  churn_reason: null,
  consent_anonymized_learning: true,
};

describe('CustomerRepo', () => {
  describe('findById', () => {
    it('行が見つかった場合はCustomerへ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: CUSTOMER_ROW, error: null });
      const repo = new CustomerRepo(client);

      const result = await repo.findById('cust-1');

      expect(result).toEqual({
        id: 'cust-1',
        storeId: 'store-1',
        name: '山田花子',
        ageGroup: '30s',
        customerType: 'B_pore',
        typeConfidence: 0.8,
        goalNote: '毛穴改善したい',
        weddingDate: null,
        acquisitionChannel: 'hotpepper',
        firstVisitDate: '2026-01-10',
        assignedStaffId: 'staff-1',
        isSubscriber: true,
        subscribedAt: '2026-02-01T00:00:00Z',
        churnScore: 0.12,
        churnReason: null,
        consentAnonymizedLearning: true,
        prefecture: null,
        city: null,
        externalKeyHash: null,
      });
    });

    it('type_confidence/churn_scoreが数値文字列の場合でもnumberへ変換する', async () => {
      const { client } = createSingleTableSupabaseMock({ data: CUSTOMER_ROW, error: null });
      const repo = new CustomerRepo(client);

      const result = await repo.findById('cust-1');

      expect(result?.typeConfidence).toBe(0.8);
      expect(result?.churnScore).toBe(0.12);
    });

    it('行が見つからない場合はnullを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new CustomerRepo(client);

      const result = await repo.findById('cust-missing');

      expect(result).toBeNull();
    });

    it('Supabaseがerrorを返した場合はCustomerRepo.findById failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'connection refused' } });
      const repo = new CustomerRepo(client);

      await expect(repo.findById('cust-1')).rejects.toThrow('CustomerRepo.findById failed: connection refused');
    });

    it('id指定とdeleted_at IS NULLでフィルタする', async () => {
      const builder = createQueryBuilderMock({ data: CUSTOMER_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new CustomerRepo(client);

      await repo.findById('cust-1');

      expect(builder.eq).toHaveBeenCalledWith('id', 'cust-1');
      expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  describe('listByStore', () => {
    it('store_idに紐づく複数行をCustomer[]へ変換して返す', async () => {
      const other: BrainCustomerRow = { ...CUSTOMER_ROW, id: 'cust-2', name: '佐藤次郎', type_confidence: 0.5, churn_score: 0.3 };
      const { client } = createSingleTableSupabaseMock({ data: [CUSTOMER_ROW, other], error: null });
      const repo = new CustomerRepo(client);

      const result = await repo.listByStore('store-1');

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id)).toEqual(['cust-1', 'cust-2']);
      expect(result[1].name).toBe('佐藤次郎');
    });

    it('dataがnullの場合は空配列を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new CustomerRepo(client);

      const result = await repo.listByStore('store-1');

      expect(result).toEqual([]);
    });

    it('Supabaseがerrorを返した場合はCustomerRepo.listByStore failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'timeout' } });
      const repo = new CustomerRepo(client);

      await expect(repo.listByStore('store-1')).rejects.toThrow('CustomerRepo.listByStore failed: timeout');
    });

    it('store_idでフィルタする', async () => {
      const builder = createQueryBuilderMock({ data: [CUSTOMER_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new CustomerRepo(client);

      await repo.listByStore('store-xyz');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-xyz');
    });
  });

  describe('updateCustomerType', () => {
    it('customer_type/type_confidenceを更新する', async () => {
      const builder = createQueryBuilderMock({ data: { ...CUSTOMER_ROW, customer_type: 'A_acne', type_confidence: '1' }, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new CustomerRepo(client);

      const result = await repo.updateCustomerType('cust-1', { customerType: 'A_acne', typeConfidence: 1 });

      expect(builder.update).toHaveBeenCalledWith({ customer_type: 'A_acne', type_confidence: 1 });
      expect(builder.eq).toHaveBeenCalledWith('id', 'cust-1');
      expect(result.customerType).toBe('A_acne');
    });

    it('customerType=nullの場合はNULLのまま保存する(架空のタイプを書き込まない)', async () => {
      const builder = createQueryBuilderMock({ data: { ...CUSTOMER_ROW, customer_type: null, type_confidence: '0' }, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new CustomerRepo(client);

      await repo.updateCustomerType('cust-1', { customerType: null, typeConfidence: 0 });

      expect(builder.update).toHaveBeenCalledWith({ customer_type: null, type_confidence: 0 });
    });

    it('Supabaseがerrorを返した場合はCustomerRepo.updateCustomerType failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db error' } });
      const repo = new CustomerRepo(client);

      await expect(repo.updateCustomerType('cust-1', { customerType: 'A_acne', typeConfidence: 1 })).rejects.toThrow(
        'CustomerRepo.updateCustomerType failed: db error'
      );
    });
  });
});

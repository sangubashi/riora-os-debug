import { describe, expect, it } from 'vitest';
import { BriefingRepo } from '../../../src/repositories/supabase/BriefingRepo';
import { createQueryBuilderMock, createSupabaseMock, type MockResult } from './testUtils';
import type { BrainFireLogRow } from '../../../src/repositories/supabase/mappers';
import type { DecisionRecord } from '../../../src/types/riora.types';

const FIRE_LOG_ROW: BrainFireLogRow = {
  id: 'fire-1',
  customer_id: 'cust-1',
  visit_id: 'visit-1',
  decision_record: {} as DecisionRecord,
  explanation: 'ホームケア提案を優先しました',
  created_at: '2026-06-12T00:00:00Z',
};

function createBriefingMock(fireLogResult: MockResult, customerResult: MockResult) {
  const fireLogBuilder = createQueryBuilderMock(fireLogResult);
  const customerBuilder = createQueryBuilderMock(customerResult);
  const client = createSupabaseMock((table) =>
    table === 'brain_pattern_fire_log' ? fireLogBuilder : customerBuilder
  );
  return { client, fireLogBuilder, customerBuilder };
}

describe('BriefingRepo', () => {
  describe('latestByCustomer', () => {
    it('直近のfire_logと顧客名を結合してBriefingEntryを返す', async () => {
      const { client } = createBriefingMock(
        { data: FIRE_LOG_ROW, error: null },
        { data: { name: '山田花子' }, error: null }
      );
      const repo = new BriefingRepo(client);

      const result = await repo.latestByCustomer('cust-1');

      expect(result).toEqual({
        id: 'fire-1',
        customerId: 'cust-1',
        customerName: '山田花子',
        visitId: 'visit-1',
        decisionRecord: FIRE_LOG_ROW.decision_record,
        explanation: 'ホームケア提案を優先しました',
        createdAt: '2026-06-12T00:00:00Z',
      });
    });

    it('fire_logが見つからない場合はnullを返す(顧客取得は行わない)', async () => {
      const { client, customerBuilder } = createBriefingMock(
        { data: null, error: null },
        { data: null, error: null }
      );
      const repo = new BriefingRepo(client);

      const result = await repo.latestByCustomer('cust-1');

      expect(result).toBeNull();
      expect(customerBuilder.select).not.toHaveBeenCalled();
    });

    it('顧客が見つからない場合はcustomerNameを空文字にする', async () => {
      const { client } = createBriefingMock({ data: FIRE_LOG_ROW, error: null }, { data: null, error: null });
      const repo = new BriefingRepo(client);

      const result = await repo.latestByCustomer('cust-1');

      expect(result?.customerName).toBe('');
    });

    it('brain_pattern_fire_log取得でerrorの場合はBriefingRepo.latestByCustomer failedで例外を投げる', async () => {
      const { client } = createBriefingMock(
        { data: null, error: { message: 'fire log error' } },
        { data: null, error: null }
      );
      const repo = new BriefingRepo(client);

      await expect(repo.latestByCustomer('cust-1')).rejects.toThrow(
        'BriefingRepo.latestByCustomer failed: fire log error'
      );
    });

    it('brain_customers取得でerrorの場合はBriefingRepo.latestByCustomer failedで例外を投げる', async () => {
      const { client } = createBriefingMock(
        { data: FIRE_LOG_ROW, error: null },
        { data: null, error: { message: 'customer error' } }
      );
      const repo = new BriefingRepo(client);

      await expect(repo.latestByCustomer('cust-1')).rejects.toThrow(
        'BriefingRepo.latestByCustomer failed: customer error'
      );
    });

    it('customer_id・created_at降順・limit1で取得し、顧客もidで取得する', async () => {
      const { client, fireLogBuilder, customerBuilder } = createBriefingMock(
        { data: FIRE_LOG_ROW, error: null },
        { data: { name: '山田花子' }, error: null }
      );
      const repo = new BriefingRepo(client);

      await repo.latestByCustomer('cust-1');

      expect(fireLogBuilder.eq).toHaveBeenCalledWith('customer_id', 'cust-1');
      expect(fireLogBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(fireLogBuilder.limit).toHaveBeenCalledWith(1);
      expect(customerBuilder.eq).toHaveBeenCalledWith('id', 'cust-1');
    });
  });

  describe('insert', () => {
    it('brain_pattern_fire_logへ1件追加し、顧客名を結合したBriefingEntryを返す(AI提案結果保存)', async () => {
      const { client, fireLogBuilder, customerBuilder } = createBriefingMock(
        { data: FIRE_LOG_ROW, error: null },
        { data: { name: '山田花子' }, error: null }
      );
      const repo = new BriefingRepo(client);

      const result = await repo.insert({
        storeId: 'store-1', customerId: 'cust-1', visitId: 'visit-1',
        decisionRecord: { candidates: [] }, explanation: 'ホームケア提案を優先しました',
      });

      expect(fireLogBuilder.insert).toHaveBeenCalledWith({
        store_id: 'store-1', customer_id: 'cust-1', visit_id: 'visit-1',
        decision_record: { candidates: [] }, explanation: 'ホームケア提案を優先しました',
      });
      expect(result.customerName).toBe('山田花子');
      expect(result.explanation).toBe('ホームケア提案を優先しました');
    });

    it('visitIdがnullでも保存できる(まだ来店に紐付かない提案生成時)', async () => {
      const { client, fireLogBuilder } = createBriefingMock(
        { data: { ...FIRE_LOG_ROW, visit_id: null }, error: null },
        { data: { name: '山田花子' }, error: null }
      );
      const repo = new BriefingRepo(client);

      const result = await repo.insert({
        storeId: 'store-1', customerId: 'cust-1', visitId: null,
        decisionRecord: {}, explanation: 'test',
      });

      expect(fireLogBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ visit_id: null }));
      expect(result.visitId).toBeNull();
    });

    it('Supabaseがerrorを返した場合はBriefingRepo.insert failedで例外を投げる', async () => {
      const { client } = createBriefingMock(
        { data: null, error: { message: 'insert failed' } },
        { data: null, error: null }
      );
      const repo = new BriefingRepo(client);

      await expect(repo.insert({ storeId: 'store-1', customerId: 'cust-1', visitId: null, decisionRecord: {}, explanation: 'x' }))
        .rejects.toThrow('BriefingRepo.insert failed: insert failed');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { LineQueueRepo } from '../../../src/repositories/supabase/LineQueueRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainLineQueueRow } from '../../../src/repositories/supabase/mappers';
import type { LineSendQueuePayload } from '../../../src/types/riora.types';

const PAYLOAD: LineSendQueuePayload = {
  customer_id: 'cust-1',
  store_id: 'store-1',
  scenario_code: 'scenario-A',
  template_id: 'template-1',
  scheduled_at: '2026-06-15T10:00:00Z',
  approval_status: 'pending',
};

const QUEUE_ROW: BrainLineQueueRow = {
  id: 'queue-1',
  store_id: 'store-1',
  customer_id: 'cust-1',
  trigger_type: 'scenario-A',
  template_id: 'template-1',
  scheduled_at: '2026-06-15T10:00:00Z',
  status: 'pending',
  created_at: '2026-06-13T00:00:00Z',
};

describe('LineQueueRepo', () => {
  describe('enqueue', () => {
    it('挿入された行のidを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: { id: 'queue-1' }, error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.enqueue(PAYLOAD);

      expect(result).toBe('queue-1');
    });

    it('LineSendQueuePayloadをbrain_line_send_queueのsnake_case行へ変換して渡す', async () => {
      const builder = createQueryBuilderMock({ data: { id: 'queue-1' }, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new LineQueueRepo(client);

      await repo.enqueue(PAYLOAD);

      expect(builder.insert).toHaveBeenCalledWith({
        store_id: 'store-1',
        customer_id: 'cust-1',
        trigger_type: 'scenario-A',
        template_id: 'template-1',
        scheduled_at: '2026-06-15T10:00:00Z',
        status: 'pending',
        message_draft: '',
      });
    });

    it('Supabaseがerrorを返した場合はLineQueueRepo.enqueue failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'insert failed' } });
      const repo = new LineQueueRepo(client);

      await expect(repo.enqueue(PAYLOAD)).rejects.toThrow('LineQueueRepo.enqueue failed: insert failed');
    });
  });

  describe('listPendingByStore', () => {
    it('store_id + status=pendingの行をLineQueueItem[]へ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [QUEUE_ROW], error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.listPendingByStore('store-1');

      expect(result).toEqual([
        {
          id: 'queue-1',
          storeId: 'store-1',
          customerId: 'cust-1',
          scenarioCode: 'scenario-A',
          templateId: 'template-1',
          scheduledAt: '2026-06-15T10:00:00Z',
          approvalStatus: 'pending',
          createdAt: '2026-06-13T00:00:00Z',
        },
      ]);
    });

    it('dataがnullの場合は空配列を返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.listPendingByStore('store-1');

      expect(result).toEqual([]);
    });

    it('Supabaseがerrorを返した場合はLineQueueRepo.listPendingByStore failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'timeout' } });
      const repo = new LineQueueRepo(client);

      await expect(repo.listPendingByStore('store-1')).rejects.toThrow(
        'LineQueueRepo.listPendingByStore failed: timeout'
      );
    });

    it('store_idとstatus=pendingでフィルタする', async () => {
      const builder = createQueryBuilderMock({ data: [QUEUE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new LineQueueRepo(client);

      await repo.listPendingByStore('store-1');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.eq).toHaveBeenCalledWith('status', 'pending');
    });
  });

  describe('updateStatus', () => {
    it('更新後の行をLineQueueItemへ変換して返す', async () => {
      const updatedRow: BrainLineQueueRow = { ...QUEUE_ROW, status: 'approved' };
      const { client } = createSingleTableSupabaseMock({ data: updatedRow, error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.updateStatus('queue-1', 'approved');

      expect(result).toEqual({
        id: 'queue-1',
        storeId: 'store-1',
        customerId: 'cust-1',
        scenarioCode: 'scenario-A',
        templateId: 'template-1',
        scheduledAt: '2026-06-15T10:00:00Z',
        approvalStatus: 'approved',
        createdAt: '2026-06-13T00:00:00Z',
      });
    });

    it('対象行が存在しない場合はnullを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.updateStatus('queue-999', 'approved');

      expect(result).toBeNull();
    });

    it('Supabaseがerrorを返した場合はLineQueueRepo.updateStatus failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'update failed' } });
      const repo = new LineQueueRepo(client);

      await expect(repo.updateStatus('queue-1', 'approved')).rejects.toThrow(
        'LineQueueRepo.updateStatus failed: update failed'
      );
    });

    it('idでフィルタしstatusを更新する', async () => {
      const builder = createQueryBuilderMock({ data: QUEUE_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new LineQueueRepo(client);

      await repo.updateStatus('queue-1', 'approved');

      expect(builder.update).toHaveBeenCalledWith({ status: 'approved' });
      expect(builder.eq).toHaveBeenCalledWith('id', 'queue-1');
    });
  });

  describe('recentByCustomer', () => {
    it('customer_id・created_at降順・limit nでLineQueueItem[]を返す(AI提案画面のLINE履歴参考表示用)', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [QUEUE_ROW], error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.recentByCustomer('cust-1', 5);

      expect(result).toEqual([{
        id: 'queue-1', storeId: 'store-1', customerId: 'cust-1', scenarioCode: 'scenario-A',
        templateId: 'template-1', scheduledAt: '2026-06-15T10:00:00Z', approvalStatus: 'pending',
        createdAt: '2026-06-13T00:00:00Z',
      }]);
    });

    it('該当が無い場合(LINE履歴0件)は空配列を返す(モックで埋めない)', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [], error: null });
      const repo = new LineQueueRepo(client);

      const result = await repo.recentByCustomer('cust-1', 5);

      expect(result).toEqual([]);
    });

    it('customer_idでフィルタしcreated_at降順・limitを適用する', async () => {
      const builder = createQueryBuilderMock({ data: [QUEUE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new LineQueueRepo(client);

      await repo.recentByCustomer('cust-1', 5);

      expect(builder.eq).toHaveBeenCalledWith('customer_id', 'cust-1');
      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(5);
    });

    it('Supabaseがerrorを返した場合はLineQueueRepo.recentByCustomer failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'timeout' } });
      const repo = new LineQueueRepo(client);

      await expect(repo.recentByCustomer('cust-1', 5)).rejects.toThrow('LineQueueRepo.recentByCustomer failed: timeout');
    });
  });
});

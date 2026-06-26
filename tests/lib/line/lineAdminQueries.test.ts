import { describe, expect, it } from 'vitest';
import {
  listLineThreads,
  getLineThreadMessages,
  listDeliveryHistory,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../../../src/lib/line/lineAdminQueries';
import { createQueryBuilderMock, createSupabaseMock, type MockResult } from '../../repositories/supabase/testUtils';

function mockTables(byTable: Record<string, MockResult>) {
  const builders = Object.fromEntries(Object.entries(byTable).map(([t, r]) => [t, createQueryBuilderMock(r)]));
  const client = createSupabaseMock((table) => {
    if (!builders[table]) throw new Error(`unexpected table: ${table}`);
    return builders[table];
  });
  return { client, builders };
}

describe('listLineThreads', () => {
  it('follow/unfollowイベントは会話内容ではないため除外する', async () => {
    const { client } = mockTables({
      line_send_logs: {
        data: [
          { id: '1', recipient_id: 'U1', message_body: '[WEBHOOK incoming] follow', status: 'success', sent_at: '2026-06-01T00:00:00Z', metadata: { direction: 'incoming', event_type: 'follow' } },
        ],
        error: null,
      },
      line_user_ids: { data: [], error: null },
      customers: { data: [], error: null },
    });

    const result = await listLineThreads(client);
    expect(result).toEqual([]);
  });

  it('outgoing送信・incomingのmessageイベントは実会話として集約する', async () => {
    const { client } = mockTables({
      line_send_logs: {
        data: [
          { id: '1', recipient_id: 'U1', message_body: '送信1', status: 'success', sent_at: '2026-06-01T00:00:00Z', metadata: { direction: 'outgoing' } },
          { id: '2', recipient_id: 'U1', message_body: '受信1', status: 'success', sent_at: '2026-06-02T00:00:00Z', metadata: { direction: 'incoming', event_type: 'message' } },
        ],
        error: null,
      },
      line_user_ids: { data: [{ line_user_id: 'U1', display_name: 'テスト太郎', customer_id: null, unfollowed_at: null }], error: null },
      customers: { data: [], error: null },
    });

    const result = await listLineThreads(client);
    expect(result).toHaveLength(1);
    expect(result[0].messageCount).toBe(2);
    expect(result[0].lastMessage).toBe('受信1');
    expect(result[0].lastDirection).toBe('incoming');
    expect(result[0].displayName).toBe('テスト太郎');
  });

  it('customer_idが紐付いている場合は実顧客名を解決する', async () => {
    const { client } = mockTables({
      line_send_logs: {
        data: [{ id: '1', recipient_id: 'U1', message_body: 'こんにちは', status: 'success', sent_at: '2026-06-01T00:00:00Z', metadata: { direction: 'outgoing' } }],
        error: null,
      },
      line_user_ids: { data: [{ line_user_id: 'U1', display_name: 'LINE表示名', customer_id: 'cust-1', unfollowed_at: null }], error: null },
      customers: { data: [{ id: 'cust-1', name: '田中 葵' }], error: null },
    });

    const result = await listLineThreads(client);
    expect(result[0].customerName).toBe('田中 葵');
  });
});

describe('listLineThreads — 旧プレースホルダ本文の除外', () => {
  it('Webhook修正前の[WEBHOOK incoming] messageプレースホルダは実会話として表示しない', async () => {
    const { client } = mockTables({
      line_send_logs: {
        data: [
          { id: '1', recipient_id: 'U1', message_body: '[WEBHOOK incoming] message', status: 'success', sent_at: '2026-06-07T09:13:44.000Z', metadata: { direction: 'incoming', event_type: 'message' } },
        ],
        error: null,
      },
      line_user_ids: { data: [], error: null },
      customers: { data: [], error: null },
    });

    const result = await listLineThreads(client);
    expect(result).toEqual([]);
  });
});

describe('getLineThreadMessages', () => {
  it('follow/unfollowを除外し、時系列順のメッセージのみ返す', async () => {
    const { client } = mockTables({
      line_send_logs: {
        data: [
          { id: '1', message_body: '送信1', status: 'success', sent_at: '2026-06-01T00:00:00Z', metadata: { direction: 'outgoing' } },
          { id: '2', message_body: '[WEBHOOK incoming] unfollow', status: 'success', sent_at: '2026-06-02T00:00:00Z', metadata: { direction: 'incoming', event_type: 'unfollow' } },
        ],
        error: null,
      },
    });

    const result = await getLineThreadMessages(client, 'U1');
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('送信1');
  });
});

describe('listDeliveryHistory', () => {
  it('line_send_queueを実データのまま返す', async () => {
    const { client } = mockTables({
      line_send_queue: {
        data: [{ id: '1', customer_name: 'E2Eテスト', line_user_id: 'U1', message_body: 'テスト', status: 'sent', send_mode: 'semi', approved_at: null, sent_at: '2026-06-08T00:00:00Z', error_message: null, created_at: '2026-06-08T00:00:00Z' }],
        error: null,
      },
    });

    const result = await listDeliveryHistory(client);
    expect(result).toEqual([{
      id: '1', customerName: 'E2Eテスト', lineUserId: 'U1', messageBody: 'テスト', status: 'sent', sendMode: 'semi', approvedAt: null, sentAt: '2026-06-08T00:00:00Z', errorMessage: null, createdAt: '2026-06-08T00:00:00Z',
    }]);
  });
});

describe('listTemplates', () => {
  it('category_idからカテゴリ名を解決する', async () => {
    const { client } = mockTables({
      line_templates: { data: [{ id: 't1', category_id: 'c1', title: 'タイトル', body: '本文', tags: ['tag'], use_count: 3, is_active: true, created_at: '2026-06-01T00:00:00Z' }], error: null },
      template_categories: { data: [{ id: 'c1', name: 'カテゴリA', sort_order: 0 }], error: null },
    });

    const result = await listTemplates(client);
    expect(result[0].categoryName).toBe('カテゴリA');
    expect(result[0].useCount).toBe(3);
  });
});

describe('createTemplate / updateTemplate / deleteTemplate', () => {
  it('createTemplateは新規行を挿入して返す', async () => {
    const { client } = mockTables({
      line_templates: { data: { id: 't-new', category_id: null, title: '新規', body: '本文', tags: [], use_count: 0, is_active: true, created_at: '2026-06-25T00:00:00Z' }, error: null },
    });

    const result = await createTemplate(client, { categoryId: null, title: '新規', body: '本文', tags: [] });
    expect(result.id).toBe('t-new');
    expect(result.title).toBe('新規');
  });

  it('updateTemplateは指定フィールドのみ更新する', async () => {
    const { client, builders } = mockTables({
      line_templates: { data: { id: 't1', category_id: null, title: '更新後', body: '本文', tags: [], use_count: 0, is_active: true, created_at: '2026-06-01T00:00:00Z' }, error: null },
    });

    await updateTemplate(client, 't1', { title: '更新後' });
    expect(builders.line_templates.update).toHaveBeenCalledWith({ title: '更新後' });
  });

  it('deleteTemplateはidでdeleteを呼ぶ', async () => {
    const { client, builders } = mockTables({
      line_templates: { data: null, error: null },
    });

    await deleteTemplate(client, 't1');
    expect(builders.line_templates.delete).toHaveBeenCalled();
    expect(builders.line_templates.eq).toHaveBeenCalledWith('id', 't1');
  });
});

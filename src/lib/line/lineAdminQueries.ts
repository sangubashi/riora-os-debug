/**
 * lineAdminQueries.ts — LINE画面本物化(Pass G)のデータアクセス層
 *
 * 対象は旧customers ID空間のテーブル(line_send_logs/line_send_queue/
 * line_user_ids/line_templates/template_categories)。これらはbrain_*の
 * リポジトリパターン対象外の「クロススキーマ参照」のため、app/lib/repos.ts
 * の getServiceClient() を使い、ここに薄いクエリ関数として置く
 * (新規Repositoryクラスは作らない・既存テーブル構造は変更しない)。
 *
 * line_logs(18件)は調査の結果demo_seed_fixed.sqlによる架空の会話文だと判明したため、
 * 本物のチャット/配信履歴としては使用しない(docs/LINE画面_DB調査レポート.md参照)。
 * 代わりにline_send_logs(Webhook受信ログ+送信実行ログ・実データ)を使う。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LineLogMetadata {
  direction?: 'incoming' | 'outgoing';
  event_type?: string;
  customer_id?: string | null;
  [key: string]: unknown;
}

interface LineSendLogRow {
  id: string;
  recipient_id: string;
  message_body: string;
  status: string;
  sent_at: string;
  metadata: LineLogMetadata | null;
}

export interface LineThreadSummary {
  recipientId: string;
  displayName: string | null;
  customerId: string | null;
  customerName: string | null;
  isFollowing: boolean;
  lastMessage: string;
  lastDirection: 'incoming' | 'outgoing';
  lastAt: string;
  messageCount: number;
}

export interface LineThreadMessage {
  id: string;
  message: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  sentAt: string;
}

/** メッセージ本文を持つ行のみを対象とする(follow/unfollow等のイベントログは会話内容ではないため除外)。 */
/**
 * Webhookのmessageイベント受信処理を実装する前(2026-06-25より前)に記録された行は
 * message_bodyが`[WEBHOOK incoming] message`という旧プレースホルダのままで、実際の
 * 受信本文は失われている。これを実会話として表示すると架空の本文に見えるため除外する。
 */
const LEGACY_PLACEHOLDER_BODY = /^\[WEBHOOK incoming\] /;

function isRealMessageRow(row: LineSendLogRow): boolean {
  const direction = row.metadata?.direction;
  if (direction === 'outgoing') return true;
  if (direction === 'incoming' && row.metadata?.event_type === 'message') {
    return !LEGACY_PLACEHOLDER_BODY.test(row.message_body);
  }
  return false;
}

export async function listLineThreads(supabase: SupabaseClient): Promise<LineThreadSummary[]> {
  const { data: logs, error } = await supabase
    .from('line_send_logs')
    .select('id, recipient_id, message_body, status, sent_at, metadata')
    .order('sent_at', { ascending: false });
  if (error) throw new Error(error.message);

  const messageRows = (logs as LineSendLogRow[]).filter(isRealMessageRow);

  const byRecipient = new Map<string, LineSendLogRow[]>();
  for (const row of messageRows) {
    const list = byRecipient.get(row.recipient_id) ?? [];
    list.push(row);
    byRecipient.set(row.recipient_id, list);
  }
  for (const rows of Array.from(byRecipient.values())) {
    rows.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  }

  const recipientIds = Array.from(byRecipient.keys());
  const { data: users } = recipientIds.length > 0
    ? await supabase.from('line_user_ids').select('line_user_id, display_name, customer_id, unfollowed_at').in('line_user_id', recipientIds)
    : { data: [] as { line_user_id: string; display_name: string | null; customer_id: string | null; unfollowed_at: string | null }[] };
  const userByRecipient = new Map((users ?? []).map((u) => [u.line_user_id, u]));

  const customerIds = (users ?? []).map((u) => u.customer_id).filter((id): id is string => !!id);
  const { data: customers } = customerIds.length > 0
    ? await supabase.from('customers').select('id, name').in('id', customerIds)
    : { data: [] as { id: string; name: string }[] };
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name]));

  return recipientIds.map((recipientId) => {
    const rows = byRecipient.get(recipientId)!; // 既に新しい順でsent_atソート済み
    const latest = rows[0];
    const user = userByRecipient.get(recipientId) ?? null;
    return {
      recipientId,
      displayName: user?.display_name ?? null,
      customerId: user?.customer_id ?? null,
      customerName: user?.customer_id ? customerNameById.get(user.customer_id) ?? null : null,
      isFollowing: user ? user.unfollowed_at === null : false,
      lastMessage: latest.message_body,
      lastDirection: (latest.metadata?.direction ?? 'outgoing') as 'incoming' | 'outgoing',
      lastAt: latest.sent_at,
      messageCount: rows.length,
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function getLineThreadMessages(supabase: SupabaseClient, recipientId: string): Promise<LineThreadMessage[]> {
  const { data, error } = await supabase
    .from('line_send_logs')
    .select('id, message_body, status, sent_at, metadata')
    .eq('recipient_id', recipientId)
    .order('sent_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data as LineSendLogRow[])
    .filter(isRealMessageRow)
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
    .map((row) => ({
      id: row.id,
      message: row.message_body,
      direction: (row.metadata?.direction ?? 'outgoing') as 'incoming' | 'outgoing',
      status: row.status,
      sentAt: row.sent_at,
    }));
}

export interface DeliveryHistoryItem {
  id: string;
  customerName: string;
  lineUserId: string;
  messageBody: string;
  status: string;
  sendMode: string;
  approvedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export async function listDeliveryHistory(supabase: SupabaseClient): Promise<DeliveryHistoryItem[]> {
  const { data, error } = await supabase
    .from('line_send_queue')
    .select('id, customer_name, line_user_id, message_body, status, send_mode, approved_at, sent_at, error_message, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    lineUserId: row.line_user_id,
    messageBody: row.message_body,
    status: row.status,
    sendMode: row.send_mode,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }));
}

export interface LineTemplateItem {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  body: string;
  tags: string[];
  useCount: number;
  isActive: boolean;
  createdAt: string;
}

export async function listTemplates(supabase: SupabaseClient): Promise<LineTemplateItem[]> {
  const [{ data: templates, error: templatesError }, { data: categories, error: categoriesError }] = await Promise.all([
    supabase.from('line_templates').select('id, category_id, title, body, tags, use_count, is_active, created_at').order('created_at', { ascending: false }),
    supabase.from('template_categories').select('id, name, sort_order').order('sort_order', { ascending: true }),
  ]);
  if (templatesError) throw new Error(templatesError.message);
  if (categoriesError) throw new Error(categoriesError.message);

  const nameById = new Map((categories ?? []).map((c) => [c.id, c.name]));

  return (templates ?? []).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_id ? nameById.get(row.category_id) ?? null : null,
    title: row.title,
    body: row.body,
    tags: row.tags ?? [],
    useCount: row.use_count,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}

export interface TemplateInput {
  categoryId: string | null;
  title: string;
  body: string;
  tags: string[];
}

export async function createTemplate(supabase: SupabaseClient, input: TemplateInput): Promise<LineTemplateItem> {
  const { data, error } = await supabase
    .from('line_templates')
    .insert({ category_id: input.categoryId, title: input.title, body: input.body, tags: input.tags, use_count: 0, is_active: true })
    .select('id, category_id, title, body, tags, use_count, is_active, created_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, categoryId: data.category_id, categoryName: null, title: data.title, body: data.body, tags: data.tags ?? [], useCount: data.use_count, isActive: data.is_active, createdAt: data.created_at };
}

export async function updateTemplate(supabase: SupabaseClient, id: string, input: Partial<TemplateInput> & { isActive?: boolean }): Promise<LineTemplateItem> {
  const patch: Record<string, unknown> = {};
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const { data, error } = await supabase
    .from('line_templates')
    .update(patch)
    .eq('id', id)
    .select('id, category_id, title, body, tags, use_count, is_active, created_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, categoryId: data.category_id, categoryName: null, title: data.title, body: data.body, tags: data.tags ?? [], useCount: data.use_count, isActive: data.is_active, createdAt: data.created_at };
}

export async function deleteTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('line_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

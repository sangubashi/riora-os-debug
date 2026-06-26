import type { SupabaseClient } from '@supabase/supabase-js';
import type { LineQueueItem, LineQueueStatus, LineSendQueuePayload, UUID } from '../../types/riora.types';
import type { ILineQueueRepo } from '../interfaces';
import { toBrainLineSendQueueInsert, toLineQueueItem, type BrainLineQueueRow } from './mappers';

const QUEUE_COLUMNS = 'id, store_id, customer_id, trigger_type, template_id, scheduled_at, status, created_at';

export class LineQueueRepo implements ILineQueueRepo {
  constructor(private readonly client: SupabaseClient) {}

  async enqueue(payload: LineSendQueuePayload): Promise<UUID> {
    const { data, error } = await this.client
      .from('brain_line_send_queue')
      .insert(toBrainLineSendQueueInsert(payload))
      .select('id')
      .single();

    if (error) {
      throw new Error(`LineQueueRepo.enqueue failed: ${error.message}`);
    }
    return (data as unknown as { id: UUID }).id;
  }

  async listPendingByStore(storeId: UUID): Promise<LineQueueItem[]> {
    const { data, error } = await this.client
      .from('brain_line_send_queue')
      .select(QUEUE_COLUMNS)
      .eq('store_id', storeId)
      .eq('status', 'pending');

    if (error) {
      throw new Error(`LineQueueRepo.listPendingByStore failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainLineQueueRow[]).map(toLineQueueItem);
  }

  async updateStatus(id: UUID, status: LineQueueStatus): Promise<LineQueueItem | null> {
    const { data, error } = await this.client
      .from('brain_line_send_queue')
      .update({ status })
      .eq('id', id)
      .select(QUEUE_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`LineQueueRepo.updateStatus failed: ${error.message}`);
    }
    if (!data) return null;
    return toLineQueueItem(data as unknown as BrainLineQueueRow);
  }

  async recentByCustomer(customerId: UUID, n: number): Promise<LineQueueItem[]> {
    const { data, error } = await this.client
      .from('brain_line_send_queue')
      .select(QUEUE_COLUMNS)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(n);

    if (error) {
      throw new Error(`LineQueueRepo.recentByCustomer failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainLineQueueRow[]).map(toLineQueueItem);
  }
}

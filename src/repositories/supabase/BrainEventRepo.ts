import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerType } from '../../types/riora.types';
import type { BrainEvent, BrainEventType } from '../../types/brain.types';
import type { IBrainEventRepo } from '../interfaces';
import { toBrainEvent, toBrainEventInsert, type BrainEventRow } from './mappers';

const EVENT_COLUMNS =
  'id, store_anon_id, customer_hash, event_type, customer_type, staff_style, proposal_kind, ' +
  'was_accepted, occurred_on, visit_count_at, amount_band, payload';

export class BrainEventRepo implements IBrainEventRepo {
  constructor(private readonly client: SupabaseClient) {}

  async insert(event: Omit<BrainEvent, 'id'>): Promise<BrainEvent> {
    const { data, error } = await this.client
      .from('brain_events')
      .insert(toBrainEventInsert(event))
      .select(EVENT_COLUMNS)
      .single();

    if (error) {
      throw new Error(`BrainEventRepo.insert failed: ${error.message}`);
    }
    return toBrainEvent(data as unknown as BrainEventRow);
  }

  async recentByType(eventType: BrainEventType, customerType: CustomerType, n: number): Promise<BrainEvent[]> {
    const { data, error } = await this.client
      .from('brain_events')
      .select(EVENT_COLUMNS)
      .eq('event_type', eventType)
      .eq('customer_type', customerType)
      .order('occurred_on', { ascending: false })
      .limit(n);

    if (error) {
      throw new Error(`BrainEventRepo.recentByType failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainEventRow[]).map(toBrainEvent);
  }
}

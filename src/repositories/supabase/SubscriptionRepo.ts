import type { SupabaseClient } from '@supabase/supabase-js';
import type { Subscription, UUID } from '../../types/riora.types';
import type { ISubscriptionRepo } from '../interfaces';
import { toSubscription, type BrainSubscriptionRow } from './mappers';

const SUBSCRIPTION_COLUMNS = 'id, store_id, customer_id, plan_name, monthly_price, started_at, cancelled_at, cancel_reason';

export class SubscriptionRepo implements ISubscriptionRepo {
  constructor(private readonly client: SupabaseClient) {}

  async listByStore(storeId: UUID): Promise<Subscription[]> {
    const { data, error } = await this.client
      .from('brain_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('store_id', storeId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`SubscriptionRepo.listByStore failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainSubscriptionRow[]).map(toSubscription);
  }
}

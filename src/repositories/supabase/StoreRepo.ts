import type { SupabaseClient } from '@supabase/supabase-js';
import type { Store, UUID } from '../../types/riora.types';
import type { IStoreRepo } from '../interfaces';
import { toStore, type BrainStoreRow } from './mappers';

const STORE_COLUMNS = 'id, name, anon_id, anon_salt, cluster, price_tier, brain_subscription, learning_mode';

export class StoreRepo implements IStoreRepo {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: UUID): Promise<Store | null> {
    const { data, error } = await this.client
      .from('brain_stores')
      .select(STORE_COLUMNS)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`StoreRepo.findById failed: ${error.message}`);
    }
    if (!data) return null;
    return toStore(data as unknown as BrainStoreRow);
  }
}

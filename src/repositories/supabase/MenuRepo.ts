import type { SupabaseClient } from '@supabase/supabase-js';
import type { Menu, UUID } from '../../types/riora.types';
import type { IMenuRepo } from '../interfaces';
import { toMenu, type BrainMenuRow } from './mappers';

const MENU_COLUMNS = 'id, store_id, name, price, role, target_types';

export class MenuRepo implements IMenuRepo {
  constructor(private readonly client: SupabaseClient) {}

  async listByStore(storeId: UUID): Promise<Menu[]> {
    const { data, error } = await this.client
      .from('brain_menus')
      .select(MENU_COLUMNS)
      .eq('store_id', storeId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`MenuRepo.listByStore failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainMenuRow[]).map(toMenu);
  }
}

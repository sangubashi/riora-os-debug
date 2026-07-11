import type { SupabaseClient } from '@supabase/supabase-js';
import type { Menu, UUID } from '../../types/riora.types';
import type { IMenuRepo, MenuCreateInput, MenuUpdateInput } from '../interfaces';
import { toMenu, fromMenuCreateInput, fromMenuUpdateInput, type BrainMenuRow } from './mappers';

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

  async findById(id: UUID): Promise<Menu | null> {
    const { data, error } = await this.client
      .from('brain_menus')
      .select(MENU_COLUMNS)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`MenuRepo.findById failed: ${error.message}`);
    }
    return data ? toMenu(data as unknown as BrainMenuRow) : null;
  }

  async create(input: MenuCreateInput): Promise<Menu> {
    const { data, error } = await this.client
      .from('brain_menus')
      .insert(fromMenuCreateInput(input))
      .select(MENU_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(`MenuRepo.create failed: ${error?.message}`);
    }
    return toMenu(data as unknown as BrainMenuRow);
  }

  async update(id: UUID, input: MenuUpdateInput): Promise<Menu | null> {
    const { data, error } = await this.client
      .from('brain_menus')
      .update(fromMenuUpdateInput(input))
      .eq('id', id)
      .is('deleted_at', null)
      .select(MENU_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`MenuRepo.update failed: ${error.message}`);
    }
    return data ? toMenu(data as unknown as BrainMenuRow) : null;
  }

  async softDelete(id: UUID): Promise<void> {
    const { error } = await this.client
      .from('brain_menus')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error(`MenuRepo.softDelete failed: ${error.message}`);
    }
  }

  async countVisitsByMenuId(id: UUID): Promise<number> {
    const { count, error } = await this.client
      .from('brain_visits')
      .select('id', { count: 'exact', head: true })
      .eq('menu_id', id);

    if (error) {
      throw new Error(`MenuRepo.countVisitsByMenuId failed: ${error.message}`);
    }
    return count ?? 0;
  }
}

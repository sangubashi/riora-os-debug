import type { SupabaseClient } from '@supabase/supabase-js';
import type { Staff, UUID } from '../../types/riora.types';
import type { IStaffRepo } from '../interfaces';
import { toStaff, type BrainStaffRow } from './mappers';

const STAFF_COLUMNS = 'id, store_id, name, style, is_active, name_aliases';

export class StaffRepo implements IStaffRepo {
  constructor(private readonly client: SupabaseClient) {}

  async listByStore(storeId: UUID): Promise<Staff[]> {
    const { data, error } = await this.client
      .from('brain_staff')
      .select(STAFF_COLUMNS)
      .eq('store_id', storeId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`StaffRepo.listByStore failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainStaffRow[]).map(toStaff);
  }

  async addNameAlias(staffId: UUID, alias: string): Promise<Staff | null> {
    const { data: current, error: fetchError } = await this.client
      .from('brain_staff')
      .select(STAFF_COLUMNS)
      .eq('id', staffId)
      .is('deleted_at', null)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`StaffRepo.addNameAlias failed: ${fetchError.message}`);
    }
    if (!current) return null;

    const existingAliases = (current as unknown as BrainStaffRow).name_aliases ?? [];
    if (existingAliases.includes(alias)) {
      return toStaff(current as unknown as BrainStaffRow);
    }

    const { data, error } = await this.client
      .from('brain_staff')
      .update({ name_aliases: [...existingAliases, alias] })
      .eq('id', staffId)
      .select(STAFF_COLUMNS)
      .single();

    if (error) {
      throw new Error(`StaffRepo.addNameAlias failed: ${error.message}`);
    }
    return toStaff(data as unknown as BrainStaffRow);
  }

  async deactivate(staffId: UUID): Promise<Staff | null> {
    const { data, error } = await this.client
      .from('brain_staff')
      .update({ is_active: false })
      .eq('id', staffId)
      .is('deleted_at', null)
      .select(STAFF_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`StaffRepo.deactivate failed: ${error.message}`);
    }
    if (!data) return null;
    return toStaff(data as unknown as BrainStaffRow);
  }
}

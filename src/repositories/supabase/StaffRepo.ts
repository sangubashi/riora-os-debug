import type { SupabaseClient } from '@supabase/supabase-js';
import type { Staff, StaffStyle, UUID } from '../../types/riora.types';
import type { CreateStaffInput, IStaffRepo } from '../interfaces';
import { toStaff, type BrainStaffRow } from './mappers';
import { assertNotAdminAuthUid } from '../../lib/auth/preventAdminStaffLink';

const STAFF_COLUMNS = 'id, store_id, name, style, is_active, name_aliases';

/**
 * provision_staff() RPC(supabase/migrations/..._provision_staff_rpc.sql)の戻り値。
 * RETURNS TABLE のためsupabase-jsは配列で返す(単一行想定)。
 */
interface ProvisionStaffResult {
  success: boolean;
  staff_id: UUID;
  profile_id: UUID;
  store_id: UUID;
  name: string;
  style: string;
  is_active: boolean;
}

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

  /**
   * 招待経由の新規スタッフ作成(STAFF_MANAGEMENT_PHASE2_1)。profiles/brain_staffへの
   * 直接INSERTは行わず、provision_staff() RPC(単一トランザクション)のみを呼ぶ
   * (profiles欠落事故の再発防止・docs/STAFF_MANAGEMENT_PHASE2_DESIGN_2.md 3章・8章)。
   */
  async create(input: CreateStaffInput): Promise<Staff> {
    // 事故防止ガード(admin流用事故の再発防止・Phase1で実装済み・ここで初めて接続する)。
    await assertNotAdminAuthUid(input.authUid);

    const { data, error } = await this.client.rpc('provision_staff', {
      p_auth_uid: input.authUid,
      p_name: input.name,
      p_store_id: input.storeId,
      p_role: input.role,
    });

    if (error) {
      throw new Error(`StaffRepo.create failed: ${error.message}`);
    }

    const row = (Array.isArray(data) ? data[0] : data) as ProvisionStaffResult | undefined;
    if (!row) {
      throw new Error('StaffRepo.create failed: provision_staff returned no row');
    }

    return {
      id: row.staff_id,
      storeId: row.store_id,
      name: row.name,
      style: row.style as StaffStyle,
      isActive: row.is_active,
      nameAliases: [],
    };
  }
}

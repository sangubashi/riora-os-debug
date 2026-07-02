import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessSettings, UUID } from '../../types/riora.types';
import type { BusinessSettingsUpsertInput, IBusinessSettingsRepo } from '../interfaces';
import { fromBusinessSettingsUpsert, toBusinessSettings, type BrainBusinessSettingsRow } from './mappers';

const BUSINESS_SETTINGS_COLUMNS =
  'store_id, month, sales_target, fixed_costs, variable_cost_rate, seat_capacity, variable_rates';

export class BusinessSettingsRepo implements IBusinessSettingsRepo {
  constructor(private readonly client: SupabaseClient) {}

  async findByStoreAndMonth(storeId: UUID, month: string): Promise<BusinessSettings | null> {
    const { data, error } = await this.client
      .from('brain_business_settings')
      .select(BUSINESS_SETTINGS_COLUMNS)
      .eq('store_id', storeId)
      .eq('month', month)
      .maybeSingle();

    if (error) {
      throw new Error(`BusinessSettingsRepo.findByStoreAndMonth failed: ${error.message}`);
    }
    if (!data) return null;
    return toBusinessSettings(data as unknown as BrainBusinessSettingsRow);
  }

  async findLatestBeforeOrAt(storeId: UUID, month: string): Promise<BusinessSettings | null> {
    const { data, error } = await this.client
      .from('brain_business_settings')
      .select(BUSINESS_SETTINGS_COLUMNS)
      .eq('store_id', storeId)
      .lte('month', month)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`BusinessSettingsRepo.findLatestBeforeOrAt failed: ${error.message}`);
    }
    if (!data) return null;
    return toBusinessSettings(data as unknown as BrainBusinessSettingsRow);
  }

  async upsert(input: BusinessSettingsUpsertInput): Promise<BusinessSettings> {
    const { data, error } = await this.client
      .from('brain_business_settings')
      .upsert(fromBusinessSettingsUpsert(input), { onConflict: 'store_id,month' })
      .select(BUSINESS_SETTINGS_COLUMNS)
      .single();

    if (error) {
      throw new Error(`BusinessSettingsRepo.upsert failed: ${error.message}`);
    }
    return toBusinessSettings(data as unknown as BrainBusinessSettingsRow);
  }
}

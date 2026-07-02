import type { SupabaseClient } from '@supabase/supabase-js';
import type { DashboardSnapshot, UUID } from '../../types/riora.types';
import type { DashboardDailyUpsertInput, IDashboardRepo } from '../interfaces';
import { toBrainDashboardDailyUpsert, toDashboardSnapshot, type BrainDashboardRow } from './mappers';

const DASHBOARD_COLUMNS =
  'store_id, snapshot_date, monthly_sales, forecast_sales, breakeven_point, repeat_rate_90d, ' +
  'rebooking_rate, homecare_rate, segment_matrix, funnel, staff_matrix, ai_insights, ' +
  'dm_to_booking_rate, repeat_30, repeat_60, repeat_90, new_ratio, nomination_rate, ' +
  'month_profit_est, vip_customer_ids, relation_triggers, occupancy, visit_count';

export class DashboardRepo implements IDashboardRepo {
  constructor(private readonly client: SupabaseClient) {}

  async latestByStore(storeId: UUID): Promise<DashboardSnapshot | null> {
    const { data, error } = await this.client
      .from('brain_dashboard_daily')
      .select(DASHBOARD_COLUMNS)
      .eq('store_id', storeId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`DashboardRepo.latestByStore failed: ${error.message}`);
    }
    if (!data) return null;
    return toDashboardSnapshot(data as unknown as BrainDashboardRow);
  }

  async latestBeforeOrAt(storeId: UUID, date: string): Promise<DashboardSnapshot | null> {
    const { data, error } = await this.client
      .from('brain_dashboard_daily')
      .select(DASHBOARD_COLUMNS)
      .eq('store_id', storeId)
      .lte('snapshot_date', date)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`DashboardRepo.latestBeforeOrAt failed: ${error.message}`);
    }
    if (!data) return null;
    return toDashboardSnapshot(data as unknown as BrainDashboardRow);
  }

  async listSinceDate(storeId: UUID, fromDate: string): Promise<DashboardSnapshot[]> {
    const { data, error } = await this.client
      .from('brain_dashboard_daily')
      .select(DASHBOARD_COLUMNS)
      .eq('store_id', storeId)
      .gte('snapshot_date', fromDate)
      .order('snapshot_date', { ascending: true });

    if (error) {
      throw new Error(`DashboardRepo.listSinceDate failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainDashboardRow[]).map(toDashboardSnapshot);
  }

  async upsertDaily(input: DashboardDailyUpsertInput): Promise<void> {
    const { error } = await this.client
      .from('brain_dashboard_daily')
      .upsert(toBrainDashboardDailyUpsert(input), { onConflict: 'store_id,snapshot_date' });

    if (error) {
      throw new Error(`DashboardRepo.upsertDaily failed: ${error.message}`);
    }
  }
}

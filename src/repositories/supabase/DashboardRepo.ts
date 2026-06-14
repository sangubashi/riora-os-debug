import type { SupabaseClient } from '@supabase/supabase-js';
import type { DashboardSnapshot, UUID } from '../../types/riora.types';
import type { IDashboardRepo } from '../interfaces';
import { toDashboardSnapshot, type BrainDashboardRow } from './mappers';

const DASHBOARD_COLUMNS =
  'store_id, snapshot_date, monthly_sales, forecast_sales, breakeven_point, repeat_rate_90d, ' +
  'rebooking_rate, homecare_rate, segment_matrix, funnel, staff_matrix, ai_insights';

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
}

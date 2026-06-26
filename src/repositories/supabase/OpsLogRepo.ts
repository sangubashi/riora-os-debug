import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpsLog, UUID } from '../../types/riora.types';
import type { IOpsLogRepo } from '../interfaces';
import { toBrainOpsLogInsert, toOpsLog, type BrainOpsLogRow } from './mappers';

const OPS_LOG_COLUMNS = 'id, store_id, kind, actor_id, detail, created_at';

export class OpsLogRepo implements IOpsLogRepo {
  constructor(private readonly client: SupabaseClient) {}

  async insert(log: Omit<OpsLog, 'id' | 'createdAt'>): Promise<OpsLog> {
    const { data, error } = await this.client
      .from('brain_ops_logs')
      .insert(toBrainOpsLogInsert(log))
      .select(OPS_LOG_COLUMNS)
      .single();

    if (error) {
      throw new Error(`OpsLogRepo.insert failed: ${error.message}`);
    }
    return toOpsLog(data as unknown as BrainOpsLogRow);
  }

  async recentByStoreAndKind(storeId: UUID, kind: string, n: number): Promise<OpsLog[]> {
    const { data, error } = await this.client
      .from('brain_ops_logs')
      .select(OPS_LOG_COLUMNS)
      .eq('store_id', storeId)
      .eq('kind', kind)
      .order('created_at', { ascending: false })
      .limit(n);

    if (error) {
      throw new Error(`OpsLogRepo.recentByStoreAndKind failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainOpsLogRow[]).map(toOpsLog);
  }
}

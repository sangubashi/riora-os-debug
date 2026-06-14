import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScenarioCandidateRow, UUID } from '../../types/riora.types';
import type { IScenarioRepo } from '../interfaces';
import { toLastSentMap, toScenarioCandidateRow, type BrainScenarioRow, type BrainSentScenarioRow } from './mappers';

export class ScenarioRepo implements IScenarioRepo {
  constructor(private readonly client: SupabaseClient) {}

  async loadActive(storeId: UUID, customerId: UUID): Promise<ScenarioCandidateRow[]> {
    const { data: scenarios, error: scenariosError } = await this.client
      .from('brain_scenarios')
      .select('id, priority, customer_type, channel, updated_at')
      .or(`store_id.eq.${storeId},store_id.is.null`)
      .eq('is_active', true);

    if (scenariosError) {
      throw new Error(`ScenarioRepo.loadActive failed: ${scenariosError.message}`);
    }

    const { data: sent, error: sentError } = await this.client
      .from('brain_line_send_queue')
      .select('trigger_type, created_at')
      .eq('customer_id', customerId)
      .eq('status', 'sent');

    if (sentError) {
      throw new Error(`ScenarioRepo.loadActive failed: ${sentError.message}`);
    }

    const lastSentByCode = toLastSentMap((sent ?? []) as unknown as BrainSentScenarioRow[]);

    return ((scenarios ?? []) as unknown as BrainScenarioRow[]).map((row) =>
      toScenarioCandidateRow(row, lastSentByCode.get(row.id) ?? null)
    );
  }
}

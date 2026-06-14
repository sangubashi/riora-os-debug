import type { SupabaseClient } from '@supabase/supabase-js';
import type { Candidate, UUID } from '../../types/riora.types';
import type { ICandidateRepo } from '../interfaces';
import { toCandidates, type SuccessPatternRow } from './mappers';

export class CandidateRepo implements ICandidateRepo {
  constructor(private readonly client: SupabaseClient) {}

  async loadActive(storeId: UUID): Promise<Candidate[]> {
    const { data, error } = await this.client
      .from('brain_success_patterns')
      .select(
        `id, lifecycle_status, version,
         brain_pattern_steps (
           id, step_no, proposal_kind, fire_condition, base_script,
           cooldown_visits, soft_features, optimal_visit
         )`
      )
      .or(`store_id.eq.${storeId},store_id.is.null`)
      .eq('is_active', true);

    if (error) {
      throw new Error(`CandidateRepo.loadActive failed: ${error.message}`);
    }

    return ((data ?? []) as unknown as SuccessPatternRow[]).flatMap(toCandidates);
  }
}

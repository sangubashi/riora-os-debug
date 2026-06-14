import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutcomeLite, UUID } from '../../types/riora.types';
import type { IOutcomeRepo } from '../interfaces';
import { toOutcomeLite, type ProposalOutcomeRow } from './mappers';

export class OutcomeRepo implements IOutcomeRepo {
  constructor(private readonly client: SupabaseClient) {}

  async recent(customerId: UUID, n: number): Promise<OutcomeLite[]> {
    const { data, error } = await this.client
      .from('brain_proposal_outcomes')
      .select('pattern_id, step_no, proposal_kind, visit_count_at, was_executed, was_accepted, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(n);

    if (error) {
      throw new Error(`OutcomeRepo.recent failed: ${error.message}`);
    }
    return ((data ?? []) as ProposalOutcomeRow[]).map(toOutcomeLite);
  }
}

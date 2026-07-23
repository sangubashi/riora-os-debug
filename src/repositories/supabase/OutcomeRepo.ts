import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutcomeLite, UUID } from '../../types/riora.types';
import type { CreateProposalOutcomeInput, IOutcomeRepo } from '../interfaces';
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

  async create(input: CreateProposalOutcomeInput): Promise<{ id: UUID }> {
    const { data, error } = await this.client
      .from('brain_proposal_outcomes')
      .insert({
        store_id: input.storeId,
        customer_id: input.customerId,
        visit_id: input.visitId,
        staff_id: input.staffId,
        pattern_id: input.patternId,
        step_no: input.stepNo,
        proposal_kind: input.proposalKind,
        visit_count_at: input.visitCountAt,
        was_briefed: input.wasBriefed,
        was_executed: input.wasExecuted,
        was_accepted: input.wasAccepted,
        amount: input.amount,
        customer_type: input.customerType,
        staff_style: input.staffStyle,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`OutcomeRepo.create failed: ${error.message}`);
    }
    return { id: (data as { id: string }).id };
  }
}

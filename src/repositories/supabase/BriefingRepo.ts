import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefingEntry, UUID } from '../../types/riora.types';
import type { IBriefingRepo } from '../interfaces';
import { toBriefingEntry, type BrainFireLogRow } from './mappers';

const FIRE_LOG_COLUMNS = 'id, customer_id, visit_id, decision_record, explanation, created_at';

export class BriefingRepo implements IBriefingRepo {
  constructor(private readonly client: SupabaseClient) {}

  async latestByCustomer(customerId: UUID): Promise<BriefingEntry | null> {
    const { data: fireLog, error: fireLogError } = await this.client
      .from('brain_pattern_fire_log')
      .select(FIRE_LOG_COLUMNS)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fireLogError) {
      throw new Error(`BriefingRepo.latestByCustomer failed: ${fireLogError.message}`);
    }
    if (!fireLog) return null;

    const { data: customer, error: customerError } = await this.client
      .from('brain_customers')
      .select('name')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) {
      throw new Error(`BriefingRepo.latestByCustomer failed: ${customerError.message}`);
    }

    const customerName = (customer as { name: string } | null)?.name ?? '';
    return toBriefingEntry(fireLog as unknown as BrainFireLogRow, customerName);
  }

  async insert(input: {
    storeId: UUID; customerId: UUID; visitId: UUID | null;
    decisionRecord: Record<string, unknown>; explanation: string;
  }): Promise<BriefingEntry> {
    const { data, error } = await this.client
      .from('brain_pattern_fire_log')
      .insert({
        store_id: input.storeId,
        customer_id: input.customerId,
        visit_id: input.visitId,
        decision_record: input.decisionRecord,
        explanation: input.explanation,
      })
      .select(FIRE_LOG_COLUMNS)
      .single();

    if (error) {
      throw new Error(`BriefingRepo.insert failed: ${error.message}`);
    }

    const { data: customer, error: customerError } = await this.client
      .from('brain_customers')
      .select('name')
      .eq('id', input.customerId)
      .maybeSingle();

    if (customerError) {
      throw new Error(`BriefingRepo.insert failed: ${customerError.message}`);
    }

    const customerName = (customer as { name: string } | null)?.name ?? '';
    return toBriefingEntry(data as unknown as BrainFireLogRow, customerName);
  }
}

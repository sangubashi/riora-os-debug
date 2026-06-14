import type { SupabaseClient } from '@supabase/supabase-js';
import type { Customer, UUID } from '../../types/riora.types';
import type { ICustomerRepo } from '../interfaces';
import { toCustomer, type BrainCustomerRow } from './mappers';

const CUSTOMER_COLUMNS =
  'id, store_id, name, age_group, customer_type, type_confidence, goal_note, wedding_date, ' +
  'acquisition_channel, first_visit_date, assigned_staff_id, is_subscriber, subscribed_at, ' +
  'churn_score, churn_reason, consent_anonymized_learning';

export class CustomerRepo implements ICustomerRepo {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: UUID): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('brain_customers')
      .select(CUSTOMER_COLUMNS)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`CustomerRepo.findById failed: ${error.message}`);
    }
    if (!data) return null;
    return toCustomer(data as unknown as BrainCustomerRow);
  }

  async listByStore(storeId: UUID): Promise<Customer[]> {
    const { data, error } = await this.client
      .from('brain_customers')
      .select(CUSTOMER_COLUMNS)
      .eq('store_id', storeId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`CustomerRepo.listByStore failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainCustomerRow[]).map(toCustomer);
  }
}

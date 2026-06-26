import type { SupabaseClient } from '@supabase/supabase-js';
import type { Customer, CustomerType, UUID } from '../../types/riora.types';
import type { ICustomerRepo } from '../interfaces';
import { toBrainCustomerInsert, toCustomer, type BrainCustomerRow } from './mappers';

const CUSTOMER_COLUMNS =
  'id, store_id, name, age_group, customer_type, type_confidence, goal_note, wedding_date, ' +
  'acquisition_channel, first_visit_date, assigned_staff_id, is_subscriber, subscribed_at, ' +
  'churn_score, churn_reason, consent_anonymized_learning, prefecture, city, external_key_hash';

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

  async findByExternalKeyHash(storeId: UUID, externalKeyHash: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('brain_customers')
      .select(CUSTOMER_COLUMNS)
      .eq('store_id', storeId)
      .eq('external_key_hash', externalKeyHash)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`CustomerRepo.findByExternalKeyHash failed: ${error.message}`);
    }
    if (!data) return null;
    return toCustomer(data as unknown as BrainCustomerRow);
  }

  async create(input: {
    storeId: UUID;
    name: string;
    ageGroup: string | null;
    firstVisitDate: string | null;
    prefecture: string | null;
    city: string | null;
    externalKeyHash: string | null;
  }): Promise<Customer> {
    const { data, error } = await this.client
      .from('brain_customers')
      .insert(toBrainCustomerInsert(input))
      .select(CUSTOMER_COLUMNS)
      .single();

    if (error) {
      throw new Error(`CustomerRepo.create failed: ${error.message}`);
    }
    return toCustomer(data as unknown as BrainCustomerRow);
  }

  async patchFromImport(id: UUID, input: {
    ageGroup: string | null;
    firstVisitDate: string | null;
    prefecture: string | null;
    city: string | null;
  }): Promise<Customer> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`CustomerRepo.patchFromImport failed: customer not found (${id})`);
    }

    const { data, error } = await this.client
      .from('brain_customers')
      .update({
        age_group: existing.ageGroup ?? input.ageGroup,
        first_visit_date: existing.firstVisitDate ?? input.firstVisitDate,
        prefecture: existing.prefecture ?? input.prefecture,
        city: existing.city ?? input.city,
      })
      .eq('id', id)
      .select(CUSTOMER_COLUMNS)
      .single();

    if (error) {
      throw new Error(`CustomerRepo.patchFromImport failed: ${error.message}`);
    }
    return toCustomer(data as unknown as BrainCustomerRow);
  }

  async updateCustomerType(id: UUID, input: { customerType: CustomerType | null; typeConfidence: number }): Promise<Customer> {
    const { data, error } = await this.client
      .from('brain_customers')
      .update({ customer_type: input.customerType, type_confidence: input.typeConfidence })
      .eq('id', id)
      .select(CUSTOMER_COLUMNS)
      .single();

    if (error) {
      throw new Error(`CustomerRepo.updateCustomerType failed: ${error.message}`);
    }
    return toCustomer(data as unknown as BrainCustomerRow);
  }
}

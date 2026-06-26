import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, Visit } from '../../types/riora.types';
import type { IVisitRepo } from '../interfaces';
import { toBrainVisitInsert, toBrainVisitReconcileUpdate, toVisit, type BrainVisitRow } from './mappers';

const VISIT_COLUMNS =
  'id, store_id, customer_id, staff_id, menu_id, visit_date, visit_count_at, is_nomination, ' +
  'treatment_amount, retail_amount, retail_category, homecare_purchased, homecare_declined, ' +
  'next_booking_made, no_booking_reason, voice_memo_url, visit_score, source';

export class VisitRepo implements IVisitRepo {
  constructor(private readonly client: SupabaseClient) {}

  async recentByCustomer(customerId: UUID, n: number): Promise<Visit[]> {
    const { data, error } = await this.client
      .from('brain_visits')
      .select(VISIT_COLUMNS)
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(n);

    if (error) {
      throw new Error(`VisitRepo.recentByCustomer failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainVisitRow[]).map(toVisit);
  }

  async create(visit: Omit<Visit, 'id'>): Promise<Visit> {
    const { data, error } = await this.client
      .from('brain_visits')
      .insert(toBrainVisitInsert(visit))
      .select(VISIT_COLUMNS)
      .single();

    if (error) {
      throw new Error(`VisitRepo.create failed: ${error.message}`);
    }
    return toVisit(data as unknown as BrainVisitRow);
  }

  async countByCustomer(customerId: UUID): Promise<number> {
    const { count, error } = await this.client
      .from('brain_visits')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`VisitRepo.countByCustomer failed: ${error.message}`);
    }
    return count ?? 0;
  }

  async findByCustomerAndDate(customerId: UUID, visitDate: string): Promise<Visit | null> {
    const { data, error } = await this.client
      .from('brain_visits')
      .select(VISIT_COLUMNS)
      .eq('customer_id', customerId)
      .eq('visit_date', visitDate)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`VisitRepo.findByCustomerAndDate failed: ${error.message}`);
    }
    if (!data) return null;
    return toVisit(data as unknown as BrainVisitRow);
  }

  async sumSalesByStoreAndDate(storeId: UUID, visitDate: string): Promise<number> {
    const { data, error } = await this.client
      .from('brain_visits')
      .select('treatment_amount, retail_amount')
      .eq('store_id', storeId)
      .eq('visit_date', visitDate)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`VisitRepo.sumSalesByStoreAndDate failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as { treatment_amount: number; retail_amount: number }[])
      .reduce((sum, row) => sum + row.treatment_amount + row.retail_amount, 0);
  }

  async listByStore(storeId: UUID): Promise<Visit[]> {
    const { data, error } = await this.client
      .from('brain_visits')
      .select(VISIT_COLUMNS)
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: true });

    if (error) {
      throw new Error(`VisitRepo.listByStore failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainVisitRow[]).map(toVisit);
  }

  async updateMenuId(id: UUID, menuId: UUID): Promise<void> {
    const { error } = await this.client
      .from('brain_visits')
      .update({ menu_id: menuId })
      .eq('id', id)
      .eq('source', 'salonboard_import') // 安全ガード: salonboard_import限定

    if (error) {
      throw new Error(`VisitRepo.updateMenuId failed: ${error.message}`)
    }
  }

  async reconcile(id: UUID, input: {
    staffId: UUID;
    menuId: UUID;
    isNomination: boolean;
    treatmentAmount: number;
    retailAmount: number;
  }): Promise<Visit> {
    const { data, error } = await this.client
      .from('brain_visits')
      .update(toBrainVisitReconcileUpdate(input))
      .eq('id', id)
      .select(VISIT_COLUMNS)
      .single();

    if (error) {
      throw new Error(`VisitRepo.reconcile failed: ${error.message}`);
    }
    return toVisit(data as unknown as BrainVisitRow);
  }
}

/**
 * ReservationRepo.ts — reservationsテーブルのRepository実装(予約CSV Import専用)
 *
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md §4/§7
 * 責務: DBアクセスのみ(ビジネスロジック禁止・SQL禁止・Supabase Clientのクエリビルダのみ)。
 * snake_case<->camelCase変換はこのファイル内で完結させる(mappers.tsへの追加は行わない。
 * 本Repositoryはreservations専用の小規模なマッピングのため)。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID } from '../../types/riora.types';
import type { IReservationRepo, ReservationRow, ReservationUpsertInput } from '../interfaces';

interface ReservationRowRaw {
  id:                 string;
  staff_id:           string;
  brain_customer_id:  string | null;
  menu:               string;
  price:              number;
  scheduled_at:       string;
  duration_minutes:   number;
  status:             string;
  is_new_customer:    boolean;
  notes:              string | null;
}

function toDbInput(input: ReservationUpsertInput) {
  return {
    staff_id:          input.staffId,
    brain_customer_id: input.brainCustomerId,
    customer_id:       null, // legacy customers表とは連携しない(RES-2確定方針)
    menu:              input.menu,
    price:             input.price,
    scheduled_at:      input.scheduledAt,
    duration_minutes:  input.durationMinutes,
    status:            input.status,
    is_new_customer:   input.isNewCustomer,
    notes:             input.notes,
  };
}

export class ReservationRepo implements IReservationRepo {
  constructor(private readonly client: SupabaseClient) {}

  async findByNaturalKey(
    staffId: UUID,
    scheduledAt: string,
    brainCustomerId: UUID | null
  ): Promise<ReservationRow | null> {
    let query = this.client
      .from('reservations')
      .select('id')
      .eq('staff_id', staffId)
      .eq('scheduled_at', scheduledAt);

    query = brainCustomerId
      ? query.eq('brain_customer_id', brainCustomerId)
      : query.is('brain_customer_id', null);

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`ReservationRepo.findByNaturalKey failed: ${error.message}`);
    }
    return (data as { id: string } | null) ? { id: (data as { id: string }).id } : null;
  }

  async create(input: ReservationUpsertInput): Promise<ReservationRow> {
    const { data, error } = await this.client
      .from('reservations')
      .insert(toDbInput(input))
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`ReservationRepo.create failed: ${error?.message}`);
    }
    return { id: (data as ReservationRowRaw).id };
  }

  async update(id: UUID, input: ReservationUpsertInput): Promise<void> {
    const { error } = await this.client
      .from('reservations')
      .update(toDbInput(input))
      .eq('id', id);

    if (error) {
      throw new Error(`ReservationRepo.update failed: ${error.message}`);
    }
  }
}

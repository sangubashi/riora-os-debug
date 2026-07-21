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
import { prodLog } from '@/lib/stability';

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

  /**
   * (scheduled_at, brain_customer_id)は真の一意キーではない(予約番号列が存在しないための
   * 暫定キー。docs/design/RESERVATION_IMPORT_V1.md §6)。Customer Merge後に同一キーへ
   * 複数のreservationsが集約されるケースが実際に発生したため(RESERVATION_DUPLICATE_
   * FIX_2)、.maybeSingle()は使わず配列で取得し、複数件ヒット時はcreated_at昇順で
   * 最古の1件を「正」として返す(既存の重複行は削除しない・別途のクリーンアップ対象)。
   */
  async findByNaturalKey(
    scheduledAt: string,
    brainCustomerId: UUID | null
  ): Promise<ReservationRow | null> {
    let query = this.client
      .from('reservations')
      .select('id, created_at')
      .eq('scheduled_at', scheduledAt);

    query = brainCustomerId
      ? query.eq('brain_customer_id', brainCustomerId)
      : query.is('brain_customer_id', null);

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) {
      throw new Error(`ReservationRepo.findByNaturalKey failed: ${error.message}`);
    }

    const rows = (data ?? []) as { id: string; created_at: string }[];
    if (rows.length === 0) return null;

    if (rows.length > 1) {
      prodLog('warn', 'ReservationRepo.findByNaturalKey: 同一(scheduled_at, brain_customer_id)に複数のreservationsが存在', {
        scheduledAt,
        brainCustomerId,
        duplicateCount: rows.length,
        reservationIds: rows.map((r) => r.id),
      });
    }

    return { id: rows[0].id };
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

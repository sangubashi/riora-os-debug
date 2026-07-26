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
import type {
  IReservationRepo, ReservationRow, ReservationUpsertInput,
  WeeklyReservationDayCount, WeeklyReservationSummary,
} from '../interfaces';
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

const WEEK_DAY_ORDER: WeeklyReservationDayCount['dayOfWeek'][] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * asOfDate(YYYY-MM-DD)を含む週の月曜日を返す。UTC専用のDateメソッドのみを使い、
 * サーバーのローカルタイムゾーン設定に依存しない(OccupancyRepo.visitsByDayOfWeekと
 * 同じ「日付文字列をUTC固定で解釈する」方針を踏襲)。
 */
function mondayOfWeek(asOfDate: string): string {
  const [y, m, d] = asOfDate.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const dow = anchor.getUTCDay(); // 0=日,1=月,...,6=土
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  anchor.setUTCDate(anchor.getUTCDate() + diffToMonday);
  return anchor.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** JST基準の曜日キーへ変換(OccupancyRepo.visitsByDayOfWeekと同じ変換方式)。 */
function dayOfWeekKeyOfJstDate(jstDateStr: string): WeeklyReservationDayCount['dayOfWeek'] {
  const jsDay = new Date(`${jstDateStr}T00:00:00Z`).getUTCDay(); // 0=日,1=月,...,6=土
  return WEEK_DAY_ORDER[(jsDay + 6) % 7];
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

  /**
   * 経営TOP「今週の予約状況」カード用(ADMIN_DASHBOARD_WEEKLY_RESERVATIONS)。
   * status='cancelled'は/api/home/reservationsと同じ既存方針で除外する。
   * 予約率・稼働率・空き枠率(営業時間/シフトを分母とする計算)は一切算出しない。
   */
  async weeklySummary(asOfDate: string): Promise<WeeklyReservationSummary> {
    const weekStart = mondayOfWeek(asOfDate);
    const weekEnd = addDays(weekStart, 6);

    const { data, error } = await this.client
      .from('reservations')
      .select('id, staff_id, menu, price, scheduled_at, status')
      .gte('scheduled_at', `${weekStart}T00:00:00+09:00`)
      .lte('scheduled_at', `${weekEnd}T23:59:59+09:00`)
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true });

    if (error) {
      throw new Error(`ReservationRepo.weeklySummary failed: ${error.message}`);
    }

    const rows = (data ?? []) as unknown as {
      id: string; staff_id: string; menu: string; price: number; scheduled_at: string; status: string;
    }[];

    // staff_idはauth.users.id(profiles.id)。brain_staff.user_idで氏名を解決する
    // (reservations.staff_idのコメント・app/api/home/reservations/route.tsと同じ方針)。
    const staffUserIds = Array.from(new Set(rows.map((r) => r.staff_id)));
    let staffNameByUserId = new Map<string, string>();
    if (staffUserIds.length > 0) {
      const { data: staffRows, error: staffError } = await this.client
        .from('brain_staff')
        .select('user_id, name')
        .in('user_id', staffUserIds);
      if (staffError) {
        throw new Error(`ReservationRepo.weeklySummary failed: ${staffError.message}`);
      }
      staffNameByUserId = new Map(
        ((staffRows ?? []) as unknown as { user_id: string | null; name: string }[])
          .filter((s): s is { user_id: string; name: string } => s.user_id !== null)
          .map((s) => [s.user_id, s.name])
      );
    }

    const counts = new Map<WeeklyReservationDayCount['dayOfWeek'], number>(WEEK_DAY_ORDER.map((d) => [d, 0]));
    let forecastSales = 0;

    const reservations = rows.map((r) => {
      const jstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(r.scheduled_at));
      const dayOfWeek = dayOfWeekKeyOfJstDate(jstDate);
      counts.set(dayOfWeek, (counts.get(dayOfWeek) ?? 0) + 1);
      forecastSales += r.price;
      return {
        id: r.id,
        dayOfWeek,
        scheduledAt: r.scheduled_at,
        staffName: staffNameByUserId.get(r.staff_id) ?? null,
        menu: r.menu,
        status: r.status as WeeklyReservationSummary['reservations'][number]['status'],
      };
    });

    return {
      weekStart,
      weekEnd,
      dayOfWeekCounts: WEEK_DAY_ORDER.map((dayOfWeek) => ({ dayOfWeek, count: counts.get(dayOfWeek) ?? 0 })),
      totalCount: rows.length,
      forecastSales,
      reservations,
    };
  }
}

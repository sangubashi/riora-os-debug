/**
 * OccupancyRepo.ts — 画面⑤稼働率分析(MD-5)のRepository
 *
 * ユーザー指示(2026-06-23)により、本タスクの集計ロジック(スタッフ別集計・曜日別集計)は
 * Repository層に置く(MD-1〜MD-4で採用したsrc/lib配下のEngineファイルへ分離するパターンとは
 * 異なる、本タスク限定の方針)。新規業務テーブル・migrationは追加せず、既存brain_visits/
 * brain_staffのみを使用する。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID } from '../../types/riora.types';
import type {
  IOccupancyRepo, StaffOccupancyRow, DayOfWeekVisitCount,
  HourlyVisitCount, DailyOccupancyPoint,
} from '../interfaces';

const DAY_ORDER: DayOfWeekVisitCount['dayOfWeek'][] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface RawVisitRow {
  staff_id: string;
  visit_date: string;
  treatment_amount: number;
  retail_amount: number;
  is_nomination: boolean;
}

export class OccupancyRepo implements IOccupancyRepo {
  constructor(private readonly client: SupabaseClient) {}

  async staffOccupancy(storeId: UUID): Promise<StaffOccupancyRow[]> {
    const [staffResult, visitResult] = await Promise.all([
      this.client.from('brain_staff').select('id, name').eq('store_id', storeId).is('deleted_at', null),
      this.client.from('brain_visits')
        .select('staff_id, visit_date, treatment_amount, retail_amount, is_nomination')
        .eq('store_id', storeId)
        .is('deleted_at', null),
    ]);

    if (staffResult.error) {
      throw new Error(`OccupancyRepo.staffOccupancy failed: ${staffResult.error.message}`);
    }
    if (visitResult.error) {
      throw new Error(`OccupancyRepo.staffOccupancy failed: ${visitResult.error.message}`);
    }

    const visitsByStaff = new Map<string, RawVisitRow[]>();
    for (const v of (visitResult.data ?? []) as unknown as RawVisitRow[]) {
      const list = visitsByStaff.get(v.staff_id) ?? [];
      list.push(v);
      visitsByStaff.set(v.staff_id, list);
    }

    return ((staffResult.data ?? []) as unknown as { id: string; name: string }[]).map((s) => {
      const visits = visitsByStaff.get(s.id) ?? [];
      const visitCount = visits.length;
      const sales = visits.reduce((sum, v) => sum + v.treatment_amount + v.retail_amount, 0);
      const nominationRate = visitCount > 0
        ? visits.filter((v) => v.is_nomination).length / visitCount
        : null;
      return { staffId: s.id, staffName: s.name, visitCount, sales, nominationRate };
    });
  }

  async visitsByDayOfWeek(storeId: UUID): Promise<DayOfWeekVisitCount[]> {
    const { data, error } = await this.client
      .from('brain_visits')
      .select('visit_date')
      .eq('store_id', storeId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`OccupancyRepo.visitsByDayOfWeek failed: ${error.message}`);
    }

    const counts = new Map<DayOfWeekVisitCount['dayOfWeek'], number>(DAY_ORDER.map((d) => [d, 0]));
    for (const row of (data ?? []) as unknown as { visit_date: string }[]) {
      // visit_dateはdate型(時刻無し)。UTC固定で解釈しタイムゾーンによるずれを防ぐ。
      const jsDay = new Date(`${row.visit_date}T00:00:00Z`).getUTCDay(); // 0=日,1=月,...,6=土
      const dayKey = DAY_ORDER[(jsDay + 6) % 7]; // 月曜始まりへ変換
      counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
    }

    return DAY_ORDER.map((dayOfWeek) => ({ dayOfWeek, visitCount: counts.get(dayOfWeek) ?? 0 }));
  }

  async hourlyVisits(): Promise<HourlyVisitCount[]> {
    const { data, error } = await this.client
      .from('reservations')
      .select('scheduled_at')
      .eq('status', 'completed');

    if (error) {
      throw new Error(`OccupancyRepo.hourlyVisits failed: ${error.message}`);
    }

    const counts = new Map<number, number>();
    for (let h = 0; h < 24; h++) counts.set(h, 0);

    for (const row of (data ?? []) as unknown as { scheduled_at: string }[]) {
      // scheduled_atはtimestamptz。JST時間帯を数値で取り出す(JSTはDSTが無いためUTC+9固定で安全)。
      // RES-8修正: 旧実装はIntl.DateTimeFormat('ja-JP',...)を使っており、ja-JPロケールが
      // "17時"のように漢字の単位付き文字列を返すため、Number("17時")が常にNaNになる不具合が
      // あった(RES-7調査で発見)。単純なUTC+9算術に置き換えて修正する。
      const hour = (new Date(row.scheduled_at).getUTCHours() + 9) % 24;
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, visitCount]) => ({ hour, visitCount }));
  }

  async occupancyTrend(fromDate: string, toDate: string): Promise<DailyOccupancyPoint[]> {
    const { data, error } = await this.client
      .from('reservations')
      .select('scheduled_at, duration_minutes')
      .in('status', ['confirmed', 'completed'])
      .gte('scheduled_at', `${fromDate}T00:00:00+09:00`)
      .lte('scheduled_at', `${toDate}T23:59:59+09:00`);

    if (error) {
      throw new Error(`OccupancyRepo.occupancyTrend failed: ${error.message}`);
    }

    const minutesByDate = new Map<string, number>();
    for (const row of (data ?? []) as unknown as { scheduled_at: string; duration_minutes: number }[]) {
      const jstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(row.scheduled_at));
      minutesByDate.set(jstDate, (minutesByDate.get(jstDate) ?? 0) + row.duration_minutes);
    }

    return Array.from(minutesByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, occupiedMinutes]) => ({ date, occupiedMinutes }));
  }
}

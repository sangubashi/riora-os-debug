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
import type { IOccupancyRepo, StaffOccupancyRow, DayOfWeekVisitCount } from '../interfaces';

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
}

import { describe, expect, it, vi } from 'vitest';
import { OccupancyRepo } from '../../../src/repositories/supabase/OccupancyRepo';

type MockResult<T> = { data: T; error: { message: string } | null };

function createTwoTableMock(opts: {
  brain_staff: MockResult<unknown>;
  brain_visits: MockResult<unknown>;
}) {
  const from = vi.fn((table: string) => {
    const result = opts[table as 'brain_staff' | 'brain_visits'];
    const builder: Record<string, unknown> = {};
    const chain = vi.fn(() => builder);
    for (const m of ['select', 'eq', 'is']) builder[m] = chain;
    builder.then = (onFulfilled?: (v: MockResult<unknown>) => unknown) => Promise.resolve(result).then(onFulfilled);
    return builder;
  });
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('OccupancyRepo', () => {
  describe('staffOccupancy', () => {
    it('今月(月初〜asOfDate)の来店件数/売上/指名率のみを集計して返す(来月分・累計は含めない)', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [{ id: 's1', name: '鈴木' }, { id: 's2', name: '亀山' }], error: null },
        brain_visits: {
          data: [
            { staff_id: 's1', visit_date: '2026-06-01', treatment_amount: 8000, retail_amount: 2000, is_nomination: true },
            { staff_id: 's1', visit_date: '2026-06-02', treatment_amount: 5000, retail_amount: 0, is_nomination: false },
            // asOfDate(6/15)より後の来店は「今月」でも集計対象外(境界確認)
            { staff_id: 's1', visit_date: '2026-06-20', treatment_amount: 9999, retail_amount: 0, is_nomination: true },
          ],
          error: null,
        },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.staffOccupancy('store-1', '2026-06-15');

      expect(result[0]).toMatchObject({ staffId: 's1', staffName: '鈴木', visitCount: 2, sales: 15000, nominationRate: 0.5, occupancyRate: null });
      expect(result[1]).toMatchObject({ staffId: 's2', staffName: '亀山', visitCount: 0, sales: 0, nominationRate: null, occupancyRate: null });
    });

    it('先月データが無い場合は先月分を0扱いにして今月との差分を返す', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [{ id: 's1', name: '鈴木' }], error: null },
        brain_visits: {
          data: [
            { staff_id: 's1', visit_date: '2026-06-01', treatment_amount: 8000, retail_amount: 2000, is_nomination: true },
          ],
          error: null,
        },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.staffOccupancy('store-1', '2026-06-15');

      expect(result[0].comparison).toEqual({ visitCountDiff: 1, salesDiff: 10000, nominationRateDiff: 1, occupancyRateDiff: null });
    });

    it('先月データがある場合は今月−先月の実差分を返す', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [{ id: 's1', name: '鈴木' }], error: null },
        brain_visits: {
          data: [
            // 先月(5月): 2件・計18000円・指名0%
            { staff_id: 's1', visit_date: '2026-05-10', treatment_amount: 10000, retail_amount: 0, is_nomination: false },
            { staff_id: 's1', visit_date: '2026-05-20', treatment_amount: 8000, retail_amount: 0, is_nomination: false },
            // 今月(6月): 1件・12000円・指名100%
            { staff_id: 's1', visit_date: '2026-06-05', treatment_amount: 12000, retail_amount: 0, is_nomination: true },
          ],
          error: null,
        },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.staffOccupancy('store-1', '2026-06-15');

      expect(result[0]).toMatchObject({ visitCount: 1, sales: 12000, nominationRate: 1 });
      expect(result[0].comparison).toEqual({ visitCountDiff: -1, salesDiff: -6000, nominationRateDiff: 1, occupancyRateDiff: null });
    });

    it('今月・先月とも担当来店が無い場合はcomparisonがnull(比較データなし)', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [{ id: 's1', name: '鈴木' }], error: null },
        brain_visits: { data: [], error: null },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.staffOccupancy('store-1', '2026-06-15');

      expect(result[0]).toEqual({
        staffId: 's1', staffName: '鈴木', visitCount: 0, sales: 0, nominationRate: null, occupancyRate: null, comparison: null,
      });
    });

    it('Supabaseがstaff取得でerrorを返した場合は例外を投げる', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: null, error: { message: 'db down' } },
        brain_visits: { data: [], error: null },
      });
      const repo = new OccupancyRepo(client);

      await expect(repo.staffOccupancy('store-1', '2026-06-15')).rejects.toThrow('OccupancyRepo.staffOccupancy failed: db down');
    });

    it('Supabaseがvisits取得でerrorを返した場合は例外を投げる', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [], error: null },
        brain_visits: { data: null, error: { message: 'db down' } },
      });
      const repo = new OccupancyRepo(client);

      await expect(repo.staffOccupancy('store-1', '2026-06-15')).rejects.toThrow('OccupancyRepo.staffOccupancy failed: db down');
    });
  });

  describe('visitsByDayOfWeek', () => {
    it('visit_dateから曜日を算出し、月〜日の7件(来店0件の曜日も含む)を返す', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [], error: null },
        brain_visits: {
          data: [
            { visit_date: '2026-06-22' }, // 月曜
            { visit_date: '2026-06-22' }, // 月曜
            { visit_date: '2026-06-24' }, // 水曜
            { visit_date: '2026-06-28' }, // 日曜
          ],
          error: null,
        },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.visitsByDayOfWeek('store-1');

      expect(result).toEqual([
        { dayOfWeek: 'mon', visitCount: 2 },
        { dayOfWeek: 'tue', visitCount: 0 },
        { dayOfWeek: 'wed', visitCount: 1 },
        { dayOfWeek: 'thu', visitCount: 0 },
        { dayOfWeek: 'fri', visitCount: 0 },
        { dayOfWeek: 'sat', visitCount: 0 },
        { dayOfWeek: 'sun', visitCount: 1 },
      ]);
    });

    it('来店が0件の場合は全曜日0件で返す', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [], error: null },
        brain_visits: { data: [], error: null },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.visitsByDayOfWeek('store-1');

      expect(result.every((r) => r.visitCount === 0)).toBe(true);
      expect(result).toHaveLength(7);
    });

    it('Supabaseがerrorを返した場合は例外を投げる', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [], error: null },
        brain_visits: { data: null, error: { message: 'db down' } },
      });
      const repo = new OccupancyRepo(client);

      await expect(repo.visitsByDayOfWeek('store-1')).rejects.toThrow('OccupancyRepo.visitsByDayOfWeek failed: db down');
    });
  });
});

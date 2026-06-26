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
    it('スタッフ別の来店件数/売上/指名率を集計して返す', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [{ id: 's1', name: '鈴木' }, { id: 's2', name: '亀山' }], error: null },
        brain_visits: {
          data: [
            { staff_id: 's1', visit_date: '2026-06-01', treatment_amount: 8000, retail_amount: 2000, is_nomination: true },
            { staff_id: 's1', visit_date: '2026-06-02', treatment_amount: 5000, retail_amount: 0, is_nomination: false },
          ],
          error: null,
        },
      });
      const repo = new OccupancyRepo(client);

      const result = await repo.staffOccupancy('store-1');

      expect(result).toEqual([
        { staffId: 's1', staffName: '鈴木', visitCount: 2, sales: 15000, nominationRate: 0.5 },
        { staffId: 's2', staffName: '亀山', visitCount: 0, sales: 0, nominationRate: null },
      ]);
    });

    it('Supabaseがstaff取得でerrorを返した場合は例外を投げる', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: null, error: { message: 'db down' } },
        brain_visits: { data: [], error: null },
      });
      const repo = new OccupancyRepo(client);

      await expect(repo.staffOccupancy('store-1')).rejects.toThrow('OccupancyRepo.staffOccupancy failed: db down');
    });

    it('Supabaseがvisits取得でerrorを返した場合は例外を投げる', async () => {
      const client = createTwoTableMock({
        brain_staff: { data: [], error: null },
        brain_visits: { data: null, error: { message: 'db down' } },
      });
      const repo = new OccupancyRepo(client);

      await expect(repo.staffOccupancy('store-1')).rejects.toThrow('OccupancyRepo.staffOccupancy failed: db down');
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

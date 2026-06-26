import { describe, expect, it } from 'vitest';
import { BusinessSettingsRepo } from '../../../src/repositories/supabase/BusinessSettingsRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainBusinessSettingsRow } from '../../../src/repositories/supabase/mappers';

const SETTINGS_ROW: BrainBusinessSettingsRow = {
  store_id: 'store-1',
  month: '2026-06-01',
  sales_target: 2500000,
  fixed_costs: { rent: 437646 },
  variable_cost_rate: '0.25',
  seat_capacity: { mon: { '10': 2 } },
  variable_rates: { incentive_rate: 0.05 },
};

describe('BusinessSettingsRepo', () => {
  describe('findByStoreAndMonth', () => {
    it('行が見つかった場合はBusinessSettingsへ変換する', async () => {
      const { client } = createSingleTableSupabaseMock({ data: SETTINGS_ROW, error: null });
      const repo = new BusinessSettingsRepo(client);

      const result = await repo.findByStoreAndMonth('store-1', '2026-06-01');

      expect(result).toEqual({
        storeId: 'store-1',
        month: '2026-06-01',
        salesTarget: 2500000,
        fixedCosts: { rent: 437646 },
        variableCostRate: 0.25,
        seatCapacity: { mon: { '10': 2 } },
        variableRates: { incentive_rate: 0.05 },
      });
    });

    it('行が見つからない場合はnullを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new BusinessSettingsRepo(client);

      const result = await repo.findByStoreAndMonth('store-1', '2026-06-01');

      expect(result).toBeNull();
    });

    it('fixed_costsがnullの場合はnullを保持する(固定費未設定)', async () => {
      const row: BrainBusinessSettingsRow = { ...SETTINGS_ROW, fixed_costs: null };
      const { client } = createSingleTableSupabaseMock({ data: row, error: null });
      const repo = new BusinessSettingsRepo(client);

      const result = await repo.findByStoreAndMonth('store-1', '2026-06-01');

      expect(result?.fixedCosts).toBeNull();
    });

    it('Supabaseがerrorを返した場合はBusinessSettingsRepo.findByStoreAndMonth failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new BusinessSettingsRepo(client);

      await expect(repo.findByStoreAndMonth('store-1', '2026-06-01'))
        .rejects.toThrow('BusinessSettingsRepo.findByStoreAndMonth failed: db down');
    });

    it('store_id+monthでフィルタする', async () => {
      const builder = createQueryBuilderMock({ data: SETTINGS_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BusinessSettingsRepo(client);

      await repo.findByStoreAndMonth('store-1', '2026-06-01');

      expect(builder.eq).toHaveBeenCalledWith('store_id', 'store-1');
      expect(builder.eq).toHaveBeenCalledWith('month', '2026-06-01');
    });
  });

  describe('upsert', () => {
    it('(store_id, month)でUPSERTし、更新後の行をBusinessSettingsへ変換して返す', async () => {
      const { client, builder } = createSingleTableSupabaseMock({ data: SETTINGS_ROW, error: null });
      const repo = new BusinessSettingsRepo(client);

      const result = await repo.upsert({
        storeId: 'store-1', month: '2026-06-01',
        fixedCosts: { rent: 437646 }, variableCostRate: 0.25,
      });

      expect(builder.upsert).toHaveBeenCalledWith(
        { store_id: 'store-1', month: '2026-06-01', fixed_costs: { rent: 437646 }, variable_cost_rate: 0.25 },
        { onConflict: 'store_id,month' }
      );
      expect(result.fixedCosts).toEqual({ rent: 437646 });
      expect(result.variableCostRate).toBe(0.25);
    });

    it('未指定のフィールドはUPSERT対象から除外する(既存値/DB既定値を保持する)', async () => {
      const { client, builder } = createSingleTableSupabaseMock({ data: SETTINGS_ROW, error: null });
      const repo = new BusinessSettingsRepo(client);

      await repo.upsert({ storeId: 'store-1', month: '2026-06-01', salesTarget: 3000000 });

      expect(builder.upsert).toHaveBeenCalledWith(
        { store_id: 'store-1', month: '2026-06-01', sales_target: 3000000 },
        { onConflict: 'store_id,month' }
      );
    });

    it('Supabaseがerrorを返した場合はBusinessSettingsRepo.upsert failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'constraint violation' } });
      const repo = new BusinessSettingsRepo(client);

      await expect(repo.upsert({ storeId: 'store-1', month: '2026-06-01', variableCostRate: 0.1 }))
        .rejects.toThrow('BusinessSettingsRepo.upsert failed: constraint violation');
    });
  });
});

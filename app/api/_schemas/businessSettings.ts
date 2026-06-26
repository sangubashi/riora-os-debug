import { z } from 'zod';
import { idSchema } from './common';

/**
 * 固定費・変動費率の内訳jsonb検証スキーマ(MD-1: 固定費設定UI / variable_rates設定UI)。
 * キー名は損益分岐設計書(Riora_損益分岐・コスト構造_設計書_v1.0.md §4)記載のものを想定するが、
 * 将来の項目追加に備えキー名は固定せず任意の文字列キー+number|nullの値のみを検証する。
 */
const costBreakdownSchema = z.record(z.string(), z.number().nullable());

/** UpsertBusinessSettings(POST /api/admin/business-settings)の入力検証スキーマ。 */
export const businessSettingsUpsertSchema = z.object({
  storeId: idSchema,
  month: z.string().regex(/^\d{4}-\d{2}-01$/, 'month must be YYYY-MM-01'),
  salesTarget: z.number().nonnegative().optional(),
  fixedCosts: costBreakdownSchema.optional(),
  // DashboardAggregatorのCHECK制約(0<=x<1)に合わせる。計算式自体は変更しない。
  variableCostRate: z.number().min(0).max(0.999999).optional(),
  variableRates: costBreakdownSchema.optional(),
});

export type BusinessSettingsUpsertPayload = z.infer<typeof businessSettingsUpsertSchema>;

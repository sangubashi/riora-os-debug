import { z } from 'zod';
import { idSchema } from './common';

/** GetBriefing(GET /api/briefing?customerId=...)のクエリ検証スキーマ。 */
export const customerIdQuerySchema = z.object({
  customerId: idSchema,
});

/** GetDashboard(GET /api/dashboard?storeId=...)のクエリ検証スキーマ。 */
export const storeIdQuerySchema = z.object({
  storeId: idSchema,
});

/** GetCustomerDetailのrecentVisits件数(?limit=)。省略時5、1〜20の範囲。 */
export const recentVisitsLimitSchema = z.coerce.number().int().min(1).max(20).default(5);

/**
 * GetDashboardTop(GET /api/dashboard/top?storeId=...&date=...)のクエリ検証スキーマ。
 * dateは省略時サーバー現在日時(YYYY-MM-DD)。本日売上・当月集計の基準日として使う。
 */
export const dashboardTopQuerySchema = z.object({
  storeId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

/**
 * GetChurnRisk(GET /api/admin/churn-risk?storeId=...&date=...)のクエリ検証スキーマ。
 * dateは省略時サーバー現在日時(YYYY-MM-DD)。危険判定(最終来店からの経過日数)の基準日。
 */
export const churnRiskQuerySchema = z.object({
  storeId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

/** GetCustomerAssets(GET /api/admin/customer-assets?storeId=...)のクエリ検証スキーマ。 */
export const customerAssetsQuerySchema = z.object({
  storeId: idSchema,
});

/**
 * GetStaffAnalytics(GET /api/admin/staff-analytics?storeId=...&date=...)のクエリ検証スキーマ。
 * dateは省略時サーバー現在日時(YYYY-MM-DD)。当月売上・成長率の基準日。
 */
export const staffAnalyticsQuerySchema = z.object({
  storeId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

/** GetOccupancy(GET /api/admin/occupancy?storeId=...&date=...)のクエリ検証スキーマ。 */
export const occupancyQuerySchema = z.object({
  storeId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

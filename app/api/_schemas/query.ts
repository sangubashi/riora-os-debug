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

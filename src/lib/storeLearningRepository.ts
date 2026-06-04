/**
 * storeLearningRepository.ts
 * store_patterns テーブルへの Supabase アクセスを集約するリポジトリ層。
 *
 * 責務:
 *   - DB行 → SuccessPattern 型変換
 *   - クエリ条件の組み立て
 *   - RLS は Supabase 側に委譲（authenticated ユーザーのみ参照可）
 *
 * store_id について:
 *   profiles テーブルに store_id カラムが存在しないため、
 *   RLS = "認証済みユーザーは全 store_patterns を参照可" で運用。
 *   将来 store_id が追加された場合は fetchByStoreId に差し替える。
 */

import { supabase, DEMO_MODE } from '@/lib/supabase'
import { prodLog } from '@/lib/stability'
import type { SuccessPattern } from '@/types/storeLearning'

// ─── 行変換 ───────────────────────────────────────────────────────────────────

function rowToSuccessPattern(row: Record<string, unknown>): SuccessPattern {
  return {
    id:             row.id as string,
    customerId:     (row.customer_id     as string  | null) ?? undefined,
    customerTags:   (row.customer_tags   as string[])       ?? [],
    staffId:        (row.staff_id        as string  | null) ?? '',
    staffName:      (row.staff_name      as string  | null) ?? undefined,
    actionType:     row.action_type      as SuccessPattern['actionType'],
    actionContent:  (row.action_content  as string)         ?? '',
    actionCategory: (row.action_category as string  | null) ?? undefined,
    outcome: {
      reVisitRate:         (row.re_visit_rate         as number | null) ?? undefined,
      lineReplyRate:       (row.line_reply_rate        as number | null) ?? undefined,
      salesUp:             (row.sales_up              as number | null) ?? undefined,
      successScore:        (row.success_score         as number)        ?? 0,
      qualitativeFeedback: (row.qualitative_feedback  as string | null) ?? undefined,
    },
    context: {
      season:            (row.ctx_season             as string   | null) ?? undefined,
      concerns:          (row.ctx_concerns           as string[] | null) ?? undefined,
      insightTags:       (row.ctx_insight_tags       as string[] | null) ?? undefined,
      relationshipState: (row.ctx_relationship_state as string   | null) ?? undefined,
      visitCycleDays:    (row.ctx_visit_cycle_days   as number   | null) ?? undefined,
      timeOfDay:         (row.ctx_time_of_day        as string   | null) ?? undefined,
    },
    timing: {
      minutesAfterService: (row.minutes_after_service as number  | null) ?? undefined,
      beforeCheckout:      (row.before_checkout       as boolean | null) ?? undefined,
      serviceType:         (row.service_type          as string  | null) ?? undefined,
    },
    staffStyle:    (row.staff_style   as SuccessPattern['staffStyle']) ?? '共感型',
    effectiveness: (row.effectiveness  as number) ?? 0,
    sampleSize:    (row.sample_size    as number) ?? 0,
    lastUpdated:   (row.last_updated   as string) ?? '',
    createdAt:     (row.created_at     as string) ?? '',
  }
}

// ─── クエリ ───────────────────────────────────────────────────────────────────

export interface FetchPatternsParams {
  customerTags: string[]
  limit?:       number
}

/**
 * customerTags に関連する store_patterns を取得。
 * RLS により認証済みユーザーのみアクセス可。
 * overlaps: customerTags の少なくとも1つが customer_tags に含まれる行を返す。
 */
export async function fetchStorePatternsForCustomer(
  params: FetchPatternsParams
): Promise<SuccessPattern[]> {
  const { customerTags, limit = 50 } = params

  if (customerTags.length === 0) return []
  if (DEMO_MODE) return []   // Supabase を呼ばない

  const { data, error } = await supabase
    .from('store_patterns')
    .select([
      'id', 'customer_id', 'customer_tags', 'staff_id', 'staff_name',
      'action_type', 'action_content', 'action_category',
      're_visit_rate', 'line_reply_rate', 'sales_up',
      'success_score', 'qualitative_feedback',
      'ctx_season', 'ctx_concerns', 'ctx_insight_tags',
      'ctx_relationship_state', 'ctx_visit_cycle_days', 'ctx_time_of_day',
      'minutes_after_service', 'before_checkout', 'service_type',
      'staff_style', 'effectiveness', 'sample_size',
      'last_updated', 'created_at',
    ].join(', '))
    .overlaps('customer_tags', customerTags)
    .order('effectiveness', { ascending: false })
    .limit(limit)

  if (error) {
    // テーブル未作成・RLS エラーは全て silent fallback（接客を止めない）
    // 42P01: テーブル未存在 / PGRST116: 行0件 / PGRST301: RLS
    if (!['42P01','PGRST116','PGRST301'].includes(error.code ?? '')) {
      prodLog('warn', '[storeLearningRepository] fetch error', error.code)
    }
    return []
  }

  return (data ?? []).map(row =>
    rowToSuccessPattern(row as unknown as Record<string, unknown>)
  )
}

/**
 * 将来 store_id が追加された場合はこちらに差し替え
 * export async function fetchStorePatternsForStore(storeId: string, ...) {}
 */

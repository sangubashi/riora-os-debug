/**
 * SalonBoardSaveEngine.ts  — SalonBoard CSV 保存エンジン（3層構造版）
 *
 * 保存先:
 *   customers           — 顧客マスタ（upsert）
 *   customer_visits     — 来店履歴（insert, 重複skip）
 *   customer_action_logs — 操作ログ（csv_import を1件記録）
 *
 * DEMO_MODE=true の場合は全て skip。
 */

import { supabase, DEMO_MODE }   from '@/lib/supabase'
import { calcCustomerPhase }     from '@/lib/phase5/customerRiskEngine'
import type {
  SalonBoardImportResult,
  SalonBoardCustomer,
  SalonBoardSaveResult,
  CustomerVisitInsert,
} from '@/types'

// ─── customers upsert ────────────────────────────────────────────────────────

async function upsertCustomer(c: SalonBoardCustomer): Promise<{
  id: string | null; created: boolean; error: string | null
}> {
  // nameHash で既存顧客を検索
  const { data: existing } = await supabase
    .from('customers')
    .select('id, visit_count, total_sales')
    .eq('customer_hash_id', c.nameHash)
    .maybeSingle()

  const days  = 0  // CSV からは最終来店日のみ、daysSince は0扱い
  const phase = calcCustomerPhase({
    visits:               c.visits,
    totalSales:           c.totalSales,
    vipRank:              c.phase === 'vip' ? 3 : 0,
    churnRisk:            c.phase === 'risk' ? 70 : 10,
    daysSinceLastVisit:   days,
    recommendedCycleDays: 30,
  })

  if (existing) {
    const { error } = await supabase
      .from('customers')
      .update({
        visit_count:   Math.max(existing.visit_count ?? 0, c.visits),
        total_sales:   Math.max(existing.total_sales ?? 0, c.totalSales),
        avg_price:     c.avgSales,
        is_vip:        phase === 'vip',
        customer_type: phase === 'vip' ? 'VIP' : phase === 'risk' ? 'リスク' : 'レギュラー',
        last_visit:    c.lastVisitDate,
      })
      .eq('id', existing.id)
    return { id: existing.id, created: false, error: error?.message ?? null }
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      customer_hash_id:   c.nameHash,
      name:               c.displayName,
      visit_count:        c.visits,
      total_sales:        c.totalSales,
      avg_price:          c.avgSales,
      churn_risk:         c.phase === 'risk' ? 70 : 10,
      is_vip:             phase === 'vip',
      customer_type:      phase === 'vip' ? 'VIP' : phase === 'risk' ? 'リスク' : 'レギュラー',
      last_visit:         c.lastVisitDate,
      line_response_rate: 50,
      vip_rank:           phase === 'vip' ? 3 : 0,
    })
    .select('id')
    .single()

  return { id: data?.id ?? null, created: true, error: error?.message ?? null }
}

// ─── customer_visits insert ──────────────────────────────────────────────────

async function insertVisit(
  customerId: string,
  c:          SalonBoardCustomer,
): Promise<string | null> {
  const row: CustomerVisitInsert = {
    customer_id:     customerId,
    visit_date:      c.lastVisitDate,
    treatment:       c.treatments[0] ?? '',
    sales:           c.avgSales,
    retail_sales:    c.visits > 0 ? Math.round(c.retailSales / c.visits) : 0,
    staff_name:      c.assignedStaff[0] ?? '',
    has_next_rebook: c.rebookCount > 0,
    is_designated:   c.designatedCount > 0,
    source:          'salonboard_csv',
  }

  const { error } = await supabase
    .from('customer_visits')
    .upsert(row, { onConflict: 'customer_id,visit_date,source', ignoreDuplicates: true })

  return error?.message ?? null
}

// ─── customer_action_logs insert ─────────────────────────────────────────────

async function insertActionLog(
  customerId: string,
  c:          SalonBoardCustomer,
): Promise<void> {
  void supabase
    .from('customer_action_logs')
    .insert({
      customer_id:    customerId,
      action_type:    'csv_import',
      action_payload: {
        visits:          c.visits,
        totalSales:      c.totalSales,
        treatments:      c.treatments,
        retailSales:     c.retailSales,
        rebookCount:     c.rebookCount,
        designatedCount: c.designatedCount,
        source:          'salonboard_csv',
      },
      created_at: new Date().toISOString(),
    })
}

// ─── メイン保存関数 ───────────────────────────────────────────────────────────

export async function saveSalonBoardImport(
  importResult: SalonBoardImportResult
): Promise<SalonBoardSaveResult> {
  if (DEMO_MODE) {
    return {
      customersCreated: importResult.customers.length,
      customersUpdated: 0,
      visitsInserted:   importResult.customers.reduce((s, c) => s + c.visits, 0),
      errors:           ['[DEMO_MODE] Supabase への実際の保存はスキップされました'],
      savedAt:          new Date().toISOString(),
    }
  }

  let customersCreated = 0, customersUpdated = 0, visitsInserted = 0
  const errors: string[] = []

  for (const customer of importResult.customers) {
    // Layer 1: customers
    const { id, created, error: custErr } = await upsertCustomer(customer)
    if (custErr || !id) {
      errors.push(`[${customer.displayName}] customers upsert 失敗: ${custErr ?? 'ID取得不可'}`)
      continue
    }
    if (created) customersCreated++; else customersUpdated++

    // Layer 2: customer_visits
    const visitErr = await insertVisit(id, customer)
    if (!visitErr) visitsInserted++
    else if (!visitErr.includes('duplicate')) {
      errors.push(`[${customer.displayName}] visit insert 失敗: ${visitErr}`)
    }

    // Layer 3: customer_action_logs（fire-and-forget）
    insertActionLog(id, customer)
  }

  return { customersCreated, customersUpdated, visitsInserted, errors,
    savedAt: new Date().toISOString() }
}

// ─── 再計算トリガー ───────────────────────────────────────────────────────────

export async function refreshCustomerAnalytics(
  customerHashIds: string[]
): Promise<{ id: string; nameHash: string }[]> {
  if (DEMO_MODE || customerHashIds.length === 0) return []
  const { data, error } = await supabase
    .from('customers')
    .select('id, customer_hash_id')
    .in('customer_hash_id', customerHashIds)
  if (error || !data) return []
  return data.map(r => ({ id: r.id, nameHash: r.customer_hash_id }))
}

// ─── 再エクスポート ───────────────────────────────────────────────────────────

export type { ImportKpiSummary } from './SalonBoardImportEngine'

/**
 * GET /api/admin/customer-merge/candidates?storeId=... (顧客統合 Phase1: 候補一覧)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §1・§2
 *
 * brain_customers.name を都度toNameKey()でグルーピングして重複候補を検出する
 * ステートレス設計(DBに永続化しない)。is_internal_user=trueの顧客(スタッフ本人の
 * 試用購入記録)は対象から除外する(docs/NOTIFICATION_INTERNAL_USER_EXCLUSION.md
 * と同じ方針)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { DEMO_STORE_ID } from '@/lib/constants'
import {
  detectDuplicateGroupSummaries,
  type DuplicateDetectionCustomerInput,
  type DuplicateDetectionVisitInput,
} from '@/lib/customerMerge/detectDuplicateGroups'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  const storeId = req.nextUrl.searchParams.get('storeId') || DEMO_STORE_ID

  try {
    const supabase = getServiceClient()

    const { data: customersData, error: customerError } = await supabase
      .from('brain_customers')
      .select('id, name, first_visit_date, created_at')
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .eq('is_internal_user', false)
    if (customerError) {
      return NextResponse.json({ success: false, error: customerError.message }, { status: 500 })
    }
    const customers: DuplicateDetectionCustomerInput[] = (customersData ?? []).map((c) => ({
      id: c.id, name: c.name, firstVisitDate: c.first_visit_date, createdAt: c.created_at,
    }))
    const customerIds = customers.map((c) => c.id)

    let visits: DuplicateDetectionVisitInput[] = []
    if (customerIds.length > 0) {
      const { data: visitsData, error: visitsError } = await supabase
        .from('brain_visits')
        .select('id, customer_id, visit_date, staff_id, visit_count_at, treatment_amount, retail_amount')
        .in('customer_id', customerIds)
        .is('deleted_at', null)
      if (visitsError) {
        return NextResponse.json({ success: false, error: visitsError.message }, { status: 500 })
      }
      visits = (visitsData ?? []).map((v) => ({
        id: v.id, customerId: v.customer_id, visitDate: v.visit_date, staffId: v.staff_id,
        visitCountAt: v.visit_count_at, treatmentAmount: v.treatment_amount, retailAmount: v.retail_amount,
      }))
    }

    const groups = detectDuplicateGroupSummaries(customers, visits, new Map())

    return NextResponse.json({ success: true, groups })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

/**
 * GET /api/admin/customer-merge/candidates/[groupKey]?storeId=... (顧客統合 Phase2: グループ詳細)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §2・§3
 *
 * groupKeyは toNameKey() の結果(URLエンコード済み)。禁忌情報はlegacy customers.id
 * 空間を参照するため、resolveLegacyCustomerIds()(today-briefing/route.tsからexport済み・
 * app/api/notifications/route.tsと同じ橋渡しパターン)でbrain_customers.id → legacy
 * customers.id へ変換してから取得する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/repos'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { DEMO_STORE_ID } from '@/lib/constants'
import { resolveLegacyCustomerIds } from '../../../../today-briefing/route'
import {
  buildGroupDetail,
  type DuplicateDetectionCustomerInput,
  type DuplicateDetectionVisitInput,
} from '@/lib/customerMerge/detectDuplicateGroups'
import type { MergeGroupContraindication } from '@/types/customerMerge'
import { toNameKey } from '@/lib/import/normalizer'

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupKey: string }> }) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  const { groupKey: encodedGroupKey } = await params
  const groupKey = decodeURIComponent(encodedGroupKey)
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
    const allCustomers: DuplicateDetectionCustomerInput[] = (customersData ?? []).map((c) => ({
      id: c.id, name: c.name, firstVisitDate: c.first_visit_date, createdAt: c.created_at,
    }))

    const memberIds = allCustomers.filter((c) => toNameKey(c.name) === groupKey).map((c) => c.id)
    if (memberIds.length < 2) {
      return NextResponse.json({ success: false, error: 'group_not_found_or_not_duplicate' }, { status: 404 })
    }

    const [visitsRes, staffRes] = await Promise.all([
      supabase
        .from('brain_visits')
        .select('id, customer_id, visit_date, staff_id, visit_count_at, treatment_amount, retail_amount')
        .in('customer_id', memberIds)
        .is('deleted_at', null),
      supabase.from('brain_staff').select('id, name'),
    ])
    if (visitsRes.error) return NextResponse.json({ success: false, error: visitsRes.error.message }, { status: 500 })
    if (staffRes.error) return NextResponse.json({ success: false, error: staffRes.error.message }, { status: 500 })

    const visits: DuplicateDetectionVisitInput[] = (visitsRes.data ?? []).map((v) => ({
      id: v.id, customerId: v.customer_id, visitDate: v.visit_date, staffId: v.staff_id,
      visitCountAt: v.visit_count_at, treatmentAmount: v.treatment_amount, retailAmount: v.retail_amount,
    }))
    const staffNameById = new Map((staffRes.data ?? []).map((s) => [s.id, s.name]))

    // 禁忌情報: brain_customers.id → legacy customers.id へメンバーごとに解決してから取得
    const legacyIdEntries = await Promise.all(
      memberIds.map(async (cid) => [cid, await resolveLegacyCustomerIds(supabase, cid)] as const)
    )
    const legacyToBrainId = new Map<string, string>()
    for (const [brainId, legacyIds] of legacyIdEntries) {
      for (const legacyId of legacyIds) legacyToBrainId.set(legacyId, brainId)
    }
    const allLegacyIds = Array.from(legacyToBrainId.keys())

    let contraindications: MergeGroupContraindication[] = []
    if (allLegacyIds.length > 0) {
      const { data: contraData, error: contraError } = await supabase
        .from('contraindications')
        .select('customer_id, severity, title, description')
        .in('customer_id', allLegacyIds)
      if (contraError) return NextResponse.json({ success: false, error: contraError.message }, { status: 500 })
      contraindications = (contraData ?? [])
        .map((c) => {
          const brainId = legacyToBrainId.get(c.customer_id)
          if (!brainId) return null
          return { customerId: brainId, severity: c.severity, title: c.title, description: c.description }
        })
        .filter((c): c is MergeGroupContraindication => c !== null)
    }

    const detail = buildGroupDetail(groupKey, allCustomers, visits, staffNameById, contraindications)
    if (!detail) {
      return NextResponse.json({ success: false, error: 'group_not_found_or_not_duplicate' }, { status: 404 })
    }

    return NextResponse.json({ success: true, detail })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

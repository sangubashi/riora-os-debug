/**
 * GET/POST /api/customers/[id]/product-proposals — 店販の「提案→結果」記録
 *
 * デジタル顧客カルテ Phase1-A。brain_product_proposals(新設)を対象とする。
 * 「実際に購入した」記録(brain_visits.retail_category、CSV取込由来)とは明確に分離し、
 * このAPIから既存のretail_category/CSV import/reconcile処理には一切触れない。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 * staffIdはクライアント入力を信用せず、Bearerトークンから解決したstaffBrainIdを使う
 * (admin等でstaffBrainIdが無い場合はNULLで保存する。テーブルのstaff_idはNULL許容)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'
import { verifyVisitBelongsToCustomer } from '@/lib/customerKarte/ownership'

const RESULT_VALUES = ['purchased', 'considering', 'declined', 'next_time'] as const

const postBodySchema = z.object({
  visitId:     idSchema.nullable().optional(),
  productName: z.string().trim().min(1, 'productName is required').max(200),
  result:      z.enum(RESULT_VALUES),
})

interface ProductProposalRow {
  id:           string
  customer_id:  string
  visit_id:     string | null
  product_name: string
  result:       string
  staff_id:     string | null
  created_at:   string
}

function toApiShape(row: ProductProposalRow) {
  return {
    id:          row.id,
    visitId:     row.visit_id,
    productName: row.product_name,
    result:      row.result,
    staffId:     row.staff_id,
    createdAt:   row.created_at,
  }
}

const PRODUCT_PROPOSAL_COLUMNS = 'id, customer_id, visit_id, product_name, result, staff_id, created_at'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const visitId = req.nextUrl.searchParams.get('visitId')

  const supabase = getServiceClient()
  let query = supabase
    .from('brain_product_proposals')
    .select(PRODUCT_PROPOSAL_COLUMNS)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (visitId) query = query.eq('visit_id', visitId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as ProductProposalRow[]
  return NextResponse.json({ success: true, proposals: rows.map(toApiShape) })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = postBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }
  const input = parsed.data
  const visitId = input.visitId ?? null

  const visitOwned = await verifyVisitBelongsToCustomer(visitId, customerId)
  if (!visitOwned) {
    return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_product_proposals')
    .insert({
      store_id:     DEMO_STORE_ID,
      customer_id:  customerId,
      visit_id:     visitId,
      product_name: input.productName,
      result:       input.result,
      staff_id:     staff.staffBrainId,
    })
    .select(PRODUCT_PROPOSAL_COLUMNS)
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { success: true, proposal: toApiShape(data as unknown as ProductProposalRow) },
    { status: 201 }
  )
}

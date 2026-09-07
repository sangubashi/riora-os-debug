/**
 * GET/POST /api/customers/[id]/staff-proposals — スタッフ実提案の正式カルテ履歴
 *
 * デジタル顧客カルテ Phase1-A。brain_staff_proposals(新設)を対象とする。
 * AI/ルールベースの提案候補(booking_prompts.recommended_proposals・handover_notes.
 * recommended_actions・brain_pattern_fire_log・brain_proposal_outcomes)からは
 * 一切自動コピーしない。スタッフが実際に顧客へ伝えた内容のみをこのAPI経由で保存する。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 * staffIdはクライアント入力を信用せず、Bearerトークンから解決したstaffBrainIdを使う。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'
import { verifyVisitBelongsToCustomer } from '@/lib/customerKarte/ownership'

const postBodySchema = z.object({
  visitId:      idSchema.nullable().optional(),
  proposalText: z.string().trim().min(1, 'proposalText is required').max(500),
})

interface StaffProposalRow {
  id:            string
  customer_id:   string
  visit_id:      string | null
  staff_id:      string | null
  proposal_text: string
  status:        string
  created_at:    string
}

function toApiShape(row: StaffProposalRow) {
  return {
    id:           row.id,
    visitId:      row.visit_id,
    staffId:      row.staff_id,
    proposalText: row.proposal_text,
    status:       row.status,
    createdAt:    row.created_at,
  }
}

const STAFF_PROPOSAL_COLUMNS = 'id, customer_id, visit_id, staff_id, proposal_text, status, created_at'

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
    .from('brain_staff_proposals')
    .select(STAFF_PROPOSAL_COLUMNS)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (visitId) query = query.eq('visit_id', visitId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as StaffProposalRow[]
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
  // statusは常に'proposed'で新規作成する(DBのdefaultとも一致。実施結果は別途PATCHで更新)。
  const { data, error } = await supabase
    .from('brain_staff_proposals')
    .insert({
      store_id:      DEMO_STORE_ID,
      customer_id:   customerId,
      visit_id:      visitId,
      staff_id:      staff.staffBrainId,
      proposal_text: input.proposalText,
      status:        'proposed',
    })
    .select(STAFF_PROPOSAL_COLUMNS)
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { success: true, proposal: toApiShape(data as unknown as StaffProposalRow) },
    { status: 201 }
  )
}

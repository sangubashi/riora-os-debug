/**
 * PATCH /api/customers/[id]/staff-proposals/[proposalId] — 実施結果の更新
 *
 * デジタル顧客カルテ Phase1-A。brain_staff_proposals.status のみを更新する
 * (proposal_text/visit_id/staff_idは変更不可。修正が必要な場合は新規提案として
 * 別行を作成する運用を想定し、既存行の内容書き換えは対象外)。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 * 対象proposalが要求元customer_idに属することをAPI層で確認する
 * (customer-memories/photosの既存慣行に合わせる)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyStaffProposalBelongsToCustomer } from '@/lib/customerKarte/ownership'

const STATUS_VALUES = ['proposed', 'executed', 'declined', 'changed', 'unknown'] as const

const patchBodySchema = z.object({
  status: z.enum(STATUS_VALUES),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id, proposalId } = await params
  const idResult         = idSchema.safeParse(id)
  const proposalIdResult = idSchema.safeParse(proposalId)
  if (!idResult.success)         return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  if (!proposalIdResult.success) return NextResponse.json(toValidationErrorResponse(proposalIdResult.error), { status: 400 })
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

  const parsed = patchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  const owned = await verifyStaffProposalBelongsToCustomer(proposalIdResult.data, customerId)
  if (!owned) {
    return NextResponse.json({ success: false, error: 'proposal_not_found' }, { status: 404 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_staff_proposals')
    .update({ status: parsed.data.status })
    .eq('id', proposalIdResult.data)
    .select('id, customer_id, visit_id, staff_id, proposal_text, status, created_at')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, proposal: toApiShape(data as unknown as StaffProposalRow) })
}

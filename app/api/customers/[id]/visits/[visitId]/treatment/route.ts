/**
 * GET/PATCH /api/customers/[id]/visits/[visitId]/treatment — 今日の施術記録
 *
 * デジタル顧客カルテ Phase1-A。brain_visits へ Phase1-A で追加した4列
 * (options/products_used/machine_settings/treatment_memo)のみを対象とする。
 * menu_id/treatment_amount/retail_amount/staff_id/is_nomination 等の既存列には
 * 一切触れない(csvImportPipeline.ts の reconcile() とは完全に独立した経路)。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 * visitIdが対象customerに属することはAPI層で確認する(FK制約では表現できないため)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyVisitBelongsToCustomer } from '@/lib/customerKarte/ownership'

const patchBodySchema = z.object({
  options:          z.array(z.unknown()).max(50).optional(),
  productsUsed:     z.array(z.unknown()).max(50).optional(),
  machineSettings:  z.record(z.string(), z.unknown()).optional(),
  treatmentMemo:    z.string().trim().max(1000).nullable().optional(),
}).refine(
  (b) => b.options !== undefined || b.productsUsed !== undefined
    || b.machineSettings !== undefined || b.treatmentMemo !== undefined,
  { message: 'at least one field is required' },
)

interface TreatmentRow {
  id:                string
  options:           unknown
  products_used:     unknown
  machine_settings:  unknown
  treatment_memo:    string | null
}

function toApiShape(row: TreatmentRow) {
  return {
    visitId:          row.id,
    options:          row.options,
    productsUsed:     row.products_used,
    machineSettings:  row.machine_settings,
    treatmentMemo:    row.treatment_memo,
  }
}

async function resolveParams(params: Promise<{ id: string; visitId: string }>) {
  const { id, visitId } = await params
  const idResult      = idSchema.safeParse(id)
  const visitIdResult = idSchema.safeParse(visitId)
  if (!idResult.success)      return { error: toValidationErrorResponse(idResult.error) }
  if (!visitIdResult.success) return { error: toValidationErrorResponse(visitIdResult.error) }
  return { customerId: idResult.data, visitId: visitIdResult.data }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; visitId: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const resolved = await resolveParams(params)
  if ('error' in resolved) {
    return NextResponse.json(resolved.error, { status: 400 })
  }
  const { customerId, visitId } = resolved

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const visitOwned = await verifyVisitBelongsToCustomer(visitId, customerId)
  if (!visitOwned) {
    return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_visits')
    .select('id, options, products_used, machine_settings, treatment_memo')
    .eq('id', visitId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'visit_not_found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, treatment: toApiShape(data as unknown as TreatmentRow) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; visitId: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const resolved = await resolveParams(params)
  if ('error' in resolved) {
    return NextResponse.json(resolved.error, { status: 400 })
  }
  const { customerId, visitId } = resolved

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
  const input = parsed.data

  const visitOwned = await verifyVisitBelongsToCustomer(visitId, customerId)
  if (!visitOwned) {
    return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (input.options          !== undefined) update.options          = input.options
  if (input.productsUsed     !== undefined) update.products_used    = input.productsUsed
  if (input.machineSettings  !== undefined) update.machine_settings = input.machineSettings
  if (input.treatmentMemo    !== undefined) update.treatment_memo   = input.treatmentMemo

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_visits')
    .update(update)
    .eq('id', visitId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .select('id, options, products_used, machine_settings, treatment_memo')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'visit_not_found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, treatment: toApiShape(data as unknown as TreatmentRow) })
}

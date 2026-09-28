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
 *
 * courseOptions(2026-09-28ユーザー承認・/karte「メインコース」、旧称「今回の施術コース」):
 * brain_visits.course_options(新規列)を対象に追加した。既存のoptions(施術ポイント、
 * スマホアプリ側TreatmentRecordSection.tsxが使用)とは別列のため、双方のPATCHが互いの
 * 選択内容を上書きすることはない。
 *
 * optionItems(2026-09-28ユーザー承認・/karte「オプション」): 「今回の施術」を
 * 「メインコース」(course_options)と「オプション」(brain_visits.option_items、
 * 新規列)に構造化し、それぞれ独立して保存・取得できるようにした。
 *
 * 過去来店の編集(2026-09-28ユーザー承認・/karte「来店履歴」VisitHistorySection.tsx):
 * このエンドポイントはvisitIdの新旧を問わず元々対応済み(visit_dateによる制限は無い)。
 * TreatmentCourseEditModal.tsx/TreatmentOptionEditModal.tsxにvisitIdを渡すことで、
 * 過去来店のcourseOptions/optionItemsもこのPATCHで更新できるようにした。
 * SalonBoard CSV再取込時の保護について: csvImportPipeline.ts の reconcile() は
 * staffId/menuId/isNomination/treatmentAmount/retailAmount/checkoutId(+source列自体)
 * のみを更新し、course_options/option_itemsには一切触れない(brain_visits.source列の
 * 値がsalonboard_import/reconciled/staff_inputのいずれであっても同じ)ため、この2列は
 * 追加の保護なしに既に安全(reconcile対象外)である。手動編集時にsource列を'staff_input'
 * へ書き換える実装は意図的に行っていない(既にreconciled/salonboard_import済みの過去visitの
 * sourceを'staff_input'に変えると、翌日以降のCSV再取込でこの行がreconcile()の対象に
 * "戻ってしまい"、staffId/menuId/金額/checkoutIdが再度上書きされ得るため、かえって危険)。
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
  courseOptions:    z.array(z.string()).max(14).optional(),
  optionItems:      z.array(z.string()).max(27).optional(),
}).refine(
  (b) => b.options !== undefined || b.productsUsed !== undefined
    || b.machineSettings !== undefined || b.treatmentMemo !== undefined
    || b.courseOptions !== undefined || b.optionItems !== undefined,
  { message: 'at least one field is required' },
)

interface TreatmentRow {
  id:                string
  options:           unknown
  products_used:     unknown
  machine_settings:  unknown
  treatment_memo:    string | null
  course_options:    unknown
  option_items:      unknown
}

function toApiShape(row: TreatmentRow) {
  return {
    visitId:          row.id,
    options:          row.options,
    productsUsed:     row.products_used,
    machineSettings:  row.machine_settings,
    treatmentMemo:    row.treatment_memo,
    courseOptions:    row.course_options,
    optionItems:      row.option_items,
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
    .select('id, options, products_used, machine_settings, treatment_memo, course_options, option_items')
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
  if (input.courseOptions    !== undefined) update.course_options   = input.courseOptions
  if (input.optionItems      !== undefined) update.option_items     = input.optionItems

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_visits')
    .update(update)
    .eq('id', visitId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .select('id, options, products_used, machine_settings, treatment_memo, course_options, option_items')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'visit_not_found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, treatment: toApiShape(data as unknown as TreatmentRow) })
}

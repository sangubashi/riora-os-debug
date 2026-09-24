/**
 * PATCH /api/customers/[id]/import-salonboard-text
 *
 * 2026-09-24ユーザー承認: SalonBoard「お客様情報詳細」ページのテキストをそのまま
 * 貼り付けて、既存顧客(customerIdで特定済み)の生年月日・初回来店日・来店回数・
 * 来店きっかけ・はがき送付許諾を一括更新する(新規顧客作成は対象外・既存顧客への
 * 情報補完のみ)。パース本体はsrc/lib/customer/salonBoardTextParser.tsに委譲する
 * (電話番号は個人情報方針によりパーサー自体が一切抽出しない)。
 *
 * 貼り付けテキストに含まれていない項目はnullを返すため、その項目は更新対象から
 * 除外する(COALESCEではなく「見つかった項目だけを上書き」。既にDBにある値を
 * 空欄化しないため)。認証パターンはgoal/route.tsと同一。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'
import { parseSalonBoardDetailText } from '@/lib/customer/salonBoardTextParser'
import { calculateAge } from '@/lib/customer/birthDate'

const patchBodySchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(20000, 'text is too long'),
})

export async function PATCH(
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

  const parsed = patchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  const fields = parseSalonBoardDetailText(parsed.data.text)

  const update: Record<string, string | number | null> = {}
  if (fields.birthDate !== null) update.birth_date = fields.birthDate
  if (fields.firstVisitDate !== null) update.first_visit_date = fields.firstVisitDate
  if (fields.visitCount !== null) update.salonboard_visit_count = fields.visitCount
  if (fields.acquisitionChannel !== null) update.acquisition_channel = fields.acquisitionChannel
  if (fields.postcardConsent !== null) update.postcard_consent = fields.postcardConsent

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: 'no_recognizable_fields' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_customers')
    .update(update)
    .eq('id', customerId)
    .eq('store_id', DEMO_STORE_ID)
    .is('deleted_at', null)
    .select('birth_date, first_visit_date, salonboard_visit_count, acquisition_channel, postcard_consent')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  const row = data as {
    birth_date: string | null
    first_visit_date: string | null
    salonboard_visit_count: number | null
    acquisition_channel: string | null
    postcard_consent: string | null
  }

  return NextResponse.json({
    success:            true,
    detectedName:       fields.name,
    birthDate:          row.birth_date,
    age:                row.birth_date ? calculateAge(row.birth_date) : null,
    firstVisitDate:      row.first_visit_date,
    visitCount:         row.salonboard_visit_count,
    acquisitionChannel: row.acquisition_channel,
    postcardConsent:    row.postcard_consent,
  })
}

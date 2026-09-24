/**
 * PATCH /api/customers/[id]/birth-date — 顧客の生年月日(brain_customers.birth_date)
 *
 * 2026-09-24ユーザー承認: SalonBoardのCSV出力に生年月日列が無いため、顧客トップページ
 * (CustomerTopPage.tsx)から手動入力・コピペ入力できるようにする。表記ゆれの吸収は
 * src/lib/customer/birthDate.tsのparseFlexibleBirthDateInput()に委譲する(この
 * ルート自体はISO形式への正規化結果を受け取ってDBへ書き込むのみ)。
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン、goal/route.ts参照)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'
import { parseFlexibleBirthDateInput } from '@/lib/customer/birthDate'

const patchBodySchema = z.object({
  // 空文字/nullは「未設定に戻す」として扱う。値がある場合は表記ゆれのある自由文字列を許容し、
  // このルート側でISO形式へパースする。
  birthDate: z.string().trim().max(40, 'birthDate is too long').nullable(),
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

  const raw = parsed.data.birthDate
  let birthDate: string | null = null
  if (raw && raw.length > 0) {
    birthDate = parseFlexibleBirthDateInput(raw)
    if (!birthDate) {
      return NextResponse.json({ success: false, error: 'invalid_birth_date_format' }, { status: 400 })
    }
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('brain_customers')
    .update({ birth_date: birthDate })
    .eq('id', customerId)
    .eq('store_id', DEMO_STORE_ID)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, birthDate })
}

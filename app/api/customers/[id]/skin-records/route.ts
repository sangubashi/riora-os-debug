/**
 * GET/POST /api/customers/[id]/skin-records — 今日の肌状態(brain_skin_records)
 *
 * デジタル顧客カルテ Phase1-A。既存テーブル・既存列・既存CHECK制約(0〜5)は変更しない。
 * primary_delta の自動算出(顧客タイプ主要指標との初回比較)・AI肌診断は今回実装しない
 * (常にNULLのまま。DB側もNULL許容のため問題なし)。
 *
 * brain_skin_records.visit_id は NOT NULL UNIQUE(1 visit = 1 record)のため、
 * POST は visit_id をキーにした upsert(既存行があれば指定フィールドのみ更新、
 * 無ければ新規作成)として実装する。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyVisitBelongsToCustomer } from '@/lib/customerKarte/ownership'

const levelSchema = z.number().int().min(0).max(5)

const postBodySchema = z.object({
  visitId:      idSchema,
  acneLevel:     levelSchema.optional(),
  poreLevel:     levelSchema.optional(),
  drynessLevel:  levelSchema.optional(),
  rednessLevel:  levelSchema.optional(),
  saggingLevel:  levelSchema.optional(),
  dullnessLevel: levelSchema.optional(),
  firmnessLevel: levelSchema.optional(),
}).refine(
  (b) => [b.acneLevel, b.poreLevel, b.drynessLevel, b.rednessLevel, b.saggingLevel, b.dullnessLevel, b.firmnessLevel]
    .some((v) => v !== undefined),
  { message: 'at least one level field is required' },
)

interface SkinRecordRow {
  id:             string
  customer_id:    string
  visit_id:       string
  acne_level:     number | null
  pore_level:     number | null
  dryness_level:  number | null
  redness_level:  number | null
  sagging_level:  number | null
  dullness_level: number | null
  firmness_level: number | null
  primary_delta:  number | null
  created_at:     string
}

function toApiShape(row: SkinRecordRow) {
  return {
    id:            row.id,
    visitId:       row.visit_id,
    acneLevel:     row.acne_level,
    poreLevel:     row.pore_level,
    drynessLevel:  row.dryness_level,
    rednessLevel:  row.redness_level,
    saggingLevel:  row.sagging_level,
    dullnessLevel: row.dullness_level,
    firmnessLevel: row.firmness_level,
    primaryDelta:  row.primary_delta,
    createdAt:     row.created_at,
  }
}

const SKIN_RECORD_COLUMNS =
  'id, customer_id, visit_id, acne_level, pore_level, dryness_level, redness_level, ' +
  'sagging_level, dullness_level, firmness_level, primary_delta, created_at'

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
    .from('brain_skin_records')
    .select(SKIN_RECORD_COLUMNS)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (visitId) query = query.eq('visit_id', visitId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as SkinRecordRow[]
  return NextResponse.json({ success: true, records: rows.map(toApiShape) })
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

  const visitOwned = await verifyVisitBelongsToCustomer(input.visitId, customerId)
  if (!visitOwned) {
    return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
  }

  const supabase = getServiceClient()

  const levelFields: Record<string, number> = {}
  if (input.acneLevel     !== undefined) levelFields.acne_level     = input.acneLevel
  if (input.poreLevel     !== undefined) levelFields.pore_level     = input.poreLevel
  if (input.drynessLevel  !== undefined) levelFields.dryness_level  = input.drynessLevel
  if (input.rednessLevel  !== undefined) levelFields.redness_level  = input.rednessLevel
  if (input.saggingLevel  !== undefined) levelFields.sagging_level  = input.saggingLevel
  if (input.dullnessLevel !== undefined) levelFields.dullness_level = input.dullnessLevel
  if (input.firmnessLevel !== undefined) levelFields.firmness_level = input.firmnessLevel

  // visit_idはUNIQUE制約のため、既存行があれば指定フィールドのみ更新(部分マージ)、
  // 無ければ新規作成する(customer_id + visit_id + 指定フィールド)。
  const { data: existing, error: findError } = await supabase
    .from('brain_skin_records')
    .select('id')
    .eq('visit_id', input.visitId)
    .maybeSingle()

  if (findError) {
    return NextResponse.json({ success: false, error: findError.message }, { status: 500 })
  }

  if (existing) {
    const { data, error } = await supabase
      .from('brain_skin_records')
      .update(levelFields)
      .eq('id', (existing as { id: string }).id)
      .select(SKIN_RECORD_COLUMNS)
      .single()

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, record: toApiShape(data as unknown as SkinRecordRow) })
  }

  const { data, error } = await supabase
    .from('brain_skin_records')
    .insert({ customer_id: customerId, visit_id: input.visitId, ...levelFields })
    .select(SKIN_RECORD_COLUMNS)
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, record: toApiShape(data as unknown as SkinRecordRow) }, { status: 201 })
}

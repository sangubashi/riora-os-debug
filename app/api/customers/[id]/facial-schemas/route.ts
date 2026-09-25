/**
 * GET /api/customers/[id]/facial-schemas — 顔シェーマ履歴一覧取得(schema_date DESC)
 * PUT /api/customers/[id]/facial-schemas — 現在の機会(visit_idまたは本日JST日付)へのUPSERT
 *
 * 設計: 実装計画(顔シェーマ機能READ ONLY設計・Phase 0、2026-09-21)。
 * 認証・認可・所有権確認・担当者上書きのパターンは写真カルテAPI
 * (app/api/customers/[id]/photos/route.ts)と共通のものをそのまま踏襲する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyVisitBelongsToCustomer } from '@/lib/photos/ownership'
import { resolveStaffIdOverride } from '@/lib/staffTag/resolveStaffIdOverride'
import { DEMO_STORE_ID } from '@/lib/constants'
import { getFacialSchemaServiceClient } from '@/lib/facialSchema/facialSchemaDb'
import { todayJstDateStr } from '@/lib/facialSchema/facialSchemaSelection'
import { parseStrokesData } from '@/lib/facialSchema/strokeModel'
import {
  FACIAL_SCHEMA_SELECT_COLUMNS,
  mapFacialSchemaRow,
  type FacialSchemaRow,
} from '@/lib/facialSchema/facialSchemaApiMapping'
import { PHOTO_BUCKET, SIGNED_URL_EXPIRY_DETAIL_SEC } from '@/lib/photos/constants'

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

  const supabase = getFacialSchemaServiceClient()
  const { data, error } = await supabase
    .from('brain_customer_facial_schemas')
    .select(FACIAL_SCHEMA_SELECT_COLUMNS)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('schema_date', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as FacialSchemaRow[]
  const schemas = rows.map(mapFacialSchemaRow)

  // 過去来店の写真アップロード機能(2026-09-25): photo_pathを持つ行だけsigned URLへ解決する。
  const withPhoto = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => !!row.photo_path)
  if (withPhoto.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(withPhoto.map(({ row }) => row.photo_path as string), SIGNED_URL_EXPIRY_DETAIL_SEC)
    withPhoto.forEach(({ i }, idx) => {
      const signed = signedUrls?.[idx]
      if (signed && !signed.error) schemas[i].photoUrl = signed.signedUrl
    })
  }

  return NextResponse.json({ success: true, schemas })
}

const putBodySchema = z.object({
  visitId:     idSchema.nullable(),
  // strokes_data本体の詳細な形の検証はparseStrokesData()に委ねる(strokeModel.ts参照)。
  // ここでは「何らかの値が送られてきたか」のみを見る。
  strokesData: z.unknown(),
  // 店舗共通iPadログイン時のみ意味を持つ任意の担当者上書き(resolveStaffIdOverride参照)。
  staffId:     z.string().min(1).optional(),
})

export async function PUT(
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = putBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const { visitId, staffId: requestedStaffId } = parsed.data

  // visitIdが指定されている場合、対象customerに属することをサーバー側で検証
  // (写真カルテAPIのPOST /photosと同じ検証、src/lib/photos/ownership.tsを共用する)。
  const belongs = await verifyVisitBelongsToCustomer(visitId, customerId)
  if (!belongs) {
    return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
  }

  const supabase = getFacialSchemaServiceClient()

  // 店舗共通ログイン+担当者タグ選択(PHASE IPAD-SHARED-LOGIN-1)用: 共通アカウントからの
  // リクエストに限り、選択済みの担当者(brain_staff.id)をcreated_by/updated_byとして使う。
  const override = await resolveStaffIdOverride(supabase, staff, requestedStaffId ?? null)
  const staffBrainId = override?.staffBrainId ?? staff.staffBrainId

  const strokesData = parseStrokesData(parsed.data.strokesData)
  const schemaDate = todayJstDateStr()
  const nowIso = new Date().toISOString()

  // 「現在の機会」を特定するクエリを都度組み立てる(再利用せず毎回作り直すことで、
  // 下記の競合時リトライでも安全に再実行できるようにする)。
  const findExistingOccasion = () => {
    const base = supabase
      .from('brain_customer_facial_schemas')
      .select('id')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
    return visitId
      ? base.eq('visit_id', visitId)
      : base.is('visit_id', null).eq('schema_date', schemaDate)
  }

  const updateExisting = async (existingId: string) => {
    const { data, error } = await supabase
      .from('brain_customer_facial_schemas')
      .update({ strokes_data: strokesData, updated_by: staffBrainId, updated_at: nowIso })
      .eq('id', existingId)
      .select(FACIAL_SCHEMA_SELECT_COLUMNS)
      .single()
    return { data: data as unknown as FacialSchemaRow | null, error }
  }

  const { data: existing } = await findExistingOccasion().maybeSingle()

  if (existing) {
    const { data: updated, error } = await updateExisting((existing as { id: string }).id)
    if (error || !updated) {
      return NextResponse.json({ success: false, error: error?.message ?? 'update_failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true, schema: mapFacialSchemaRow(updated), created: false })
  }

  const { data: inserted, error: insertError } = await supabase
    .from('brain_customer_facial_schemas')
    .insert({
      store_id:    DEMO_STORE_ID,
      customer_id: customerId,
      visit_id:    visitId,
      schema_date: schemaDate,
      strokes_data: strokesData,
      created_by:  staffBrainId,
      updated_by:  staffBrainId,
    })
    .select(FACIAL_SCHEMA_SELECT_COLUMNS)
    .single()

  if (insertError) {
    // 競合(同時に別リクエストが同じ機会へ先にINSERTした、部分ユニークインデックス違反)の
    // 場合のみ、既存行を再取得してUPDATEへフォールバックする(commitCustomerPhoto.tsの
    // 23505ハンドリングと同じ考え方)。
    if ((insertError as { code?: string }).code === '23505') {
      const { data: raced } = await findExistingOccasion().maybeSingle()
      if (raced) {
        const { data: updated, error } = await updateExisting((raced as { id: string }).id)
        if (error || !updated) {
          return NextResponse.json({ success: false, error: error?.message ?? 'update_failed' }, { status: 500 })
        }
        return NextResponse.json({ success: true, schema: mapFacialSchemaRow(updated), created: false })
      }
    }
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, schema: mapFacialSchemaRow(inserted as unknown as FacialSchemaRow), created: true })
}

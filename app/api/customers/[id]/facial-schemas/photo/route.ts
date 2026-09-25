/**
 * PUT /api/customers/[id]/facial-schemas/photo — 過去来店の顔シェーマ写真アップロード
 *
 * 設計: 2026-09-25ユーザー承認。移行期でアプリ導入前の来店(brain_visits)には
 * 顔シェーマの描画データが一件も無いため、サロンボード等の紙カルテを撮影・
 * アップロードした画像を、その来店(visitId、必須)に紐付けて記録できるようにする。
 *
 * 既存の PUT /api/customers/[id]/facial-schemas(キャンバス描画・strokes_data用、
 * visitId省略時は「本日」の機会を指す)とは別ルートに分離する: このルートは
 * 必ず過去の特定visitIdを対象にし、schema_dateもその来店の実際の日付(brain_visits.
 * visit_date)を使う(「本日」を使うとVisitHistorySection.tsxの日付一致判定で
 * その来店に紐付かなくなるため)。strokes_data(ベクター描画)には一切触れない
 * (default値のまま、または既存の描画データがあればそのまま維持)。
 *
 * 認証・認可・所有権確認・担当者上書きのパターンは既存の顔シェーマAPI・写真カルテAPIと
 * 同一。ストレージ(customer-photos bucket)・MIME/サイズ制限も写真カルテと共通の
 * 定数(src/lib/photos/constants.ts)をそのまま再利用する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { resolveStaffIdOverride } from '@/lib/staffTag/resolveStaffIdOverride'
import { DEMO_STORE_ID } from '@/lib/constants'
import { getFacialSchemaServiceClient } from '@/lib/facialSchema/facialSchemaDb'
import {
  FACIAL_SCHEMA_SELECT_COLUMNS,
  mapFacialSchemaRow,
  type FacialSchemaRow,
} from '@/lib/facialSchema/facialSchemaApiMapping'
import {
  ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_UPLOAD_BYTES, PHOTO_BUCKET, PHOTO_MIME_EXTENSIONS,
  SIGNED_URL_EXPIRY_DETAIL_SEC, type AllowedPhotoMimeType,
} from '@/lib/photos/constants'

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

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_form_data' }, { status: 400 })
  }

  const visitId = form.get('visitId')
  const file = form.get('file')
  const staffIdField = form.get('staffId')
  if (typeof visitId !== 'string' || !visitId) {
    return NextResponse.json({ success: false, error: 'visit_id_required' }, { status: 400 })
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 })
  }
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type as AllowedPhotoMimeType)) {
    return NextResponse.json({ success: false, error: 'unsupported_media_type' }, { status: 415 })
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'file_too_large' }, { status: 400 })
  }

  const supabase = getFacialSchemaServiceClient()

  // visitIdが対象顧客に属することの確認と、その来店の実際の日付の取得を1クエリで行う。
  const { data: visitRow } = await supabase
    .from('brain_visits')
    .select('id, visit_date')
    .eq('id', visitId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!visitRow) {
    return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
  }
  const schemaDate = (visitRow as { visit_date: string }).visit_date

  const override = await resolveStaffIdOverride(
    supabase, staff, typeof staffIdField === 'string' ? staffIdField : null
  )
  const staffBrainId = override?.staffBrainId ?? staff.staffBrainId

  const ext = PHOTO_MIME_EXTENSIONS[file.type as AllowedPhotoMimeType]
  const path = `facial-schemas/${customerId}/${visitId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  const nowIso = new Date().toISOString()

  const { data: existing } = await supabase
    .from('brain_customer_facial_schemas')
    .select('id')
    .eq('customer_id', customerId)
    .eq('visit_id', visitId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    const { data: updated, error } = await supabase
      .from('brain_customer_facial_schemas')
      .update({ photo_path: path, updated_by: staffBrainId, updated_at: nowIso })
      .eq('id', (existing as { id: string }).id)
      .select(FACIAL_SCHEMA_SELECT_COLUMNS)
      .single()

    if (error || !updated) {
      return NextResponse.json({ success: false, error: error?.message ?? 'update_failed' }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      schema:  { ...mapFacialSchemaRow(updated as unknown as FacialSchemaRow), photoUrl: await signPhotoUrl(supabase, path) },
    })
  }

  const { data: inserted, error: insertError } = await supabase
    .from('brain_customer_facial_schemas')
    .insert({
      store_id:    DEMO_STORE_ID,
      customer_id: customerId,
      visit_id:    visitId,
      schema_date: schemaDate,
      photo_path:  path,
      created_by:  staffBrainId,
      updated_by:  staffBrainId,
    })
    .select(FACIAL_SCHEMA_SELECT_COLUMNS)
    .single()

  if (insertError) {
    // 競合(同時実行で先にINSERTされていた)場合のみ、既存行を再取得してUPDATEへ
    // フォールバックする(既存の顔シェーマPUTと同じ23505ハンドリング)。
    if ((insertError as { code?: string }).code === '23505') {
      const { data: raced } = await supabase
        .from('brain_customer_facial_schemas')
        .select('id')
        .eq('customer_id', customerId)
        .eq('visit_id', visitId)
        .is('deleted_at', null)
        .maybeSingle()
      if (raced) {
        const { data: updated, error } = await supabase
          .from('brain_customer_facial_schemas')
          .update({ photo_path: path, updated_by: staffBrainId, updated_at: nowIso })
          .eq('id', (raced as { id: string }).id)
          .select(FACIAL_SCHEMA_SELECT_COLUMNS)
          .single()
        if (error || !updated) {
          return NextResponse.json({ success: false, error: error?.message ?? 'update_failed' }, { status: 500 })
        }
        return NextResponse.json({
          success: true,
          schema:  { ...mapFacialSchemaRow(updated as unknown as FacialSchemaRow), photoUrl: await signPhotoUrl(supabase, path) },
        })
      }
    }
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    schema:  { ...mapFacialSchemaRow(inserted as unknown as FacialSchemaRow), photoUrl: await signPhotoUrl(supabase, path) },
  })
}

async function signPhotoUrl(
  supabase: ReturnType<typeof getFacialSchemaServiceClient>,
  path: string,
): Promise<string | null> {
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_DETAIL_SEC)
  return data?.signedUrl ?? null
}

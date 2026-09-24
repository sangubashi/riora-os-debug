/**
 * GET /api/customers/[id]/initial-questionnaire — 初回問診票(紙カルテスキャン)の
 *   登録状況取得(未登録ならpath:null、登録済みならsigned URLを発行して返す)。
 * PUT /api/customers/[id]/initial-questionnaire — 1枚だけの登録・更新(常に上書き)。
 *
 * 設計: 2026-09-24ユーザー承認(顧客トップページ新設)。既存の写真カルテ
 * (brain_customer_photos、body_part×photo_typeで複数枚を積み上げる設計)とは
 * 意図的に分離する。撮影機会・ゴースト比較・photo_type CHECK制約には一切
 * 関わらない、customerごとに1件だけを保持する独立カラム(brain_customers.
 * initial_questionnaire_photo_path)への読み書きに専念する。
 *
 * 認証・認可パターンは既存API(app/api/customers/[id]/photos/route.ts)と同一。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import {
  ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_UPLOAD_BYTES, PHOTO_BUCKET, PHOTO_MIME_EXTENSIONS,
  SIGNED_URL_EXPIRY_DETAIL_SEC, type AllowedPhotoMimeType,
} from '@/lib/photos/constants'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

interface CustomerRow {
  initial_questionnaire_photo_path: string | null
  initial_questionnaire_uploaded_at: string | null
}

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

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('brain_customers')
    .select('initial_questionnaire_photo_path, initial_questionnaire_uploaded_at')
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const row = data as CustomerRow | null
  const path = row?.initial_questionnaire_photo_path ?? null
  if (!path) {
    return NextResponse.json({ success: true, path: null, uploadedAt: null, url: null })
  }

  const { data: signed, error: signedError } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_DETAIL_SEC)

  if (signedError || !signed) {
    return NextResponse.json({ success: false, error: signedError?.message ?? 'signed_url_failed' }, { status: 500 })
  }

  return NextResponse.json({
    success:    true,
    path,
    uploadedAt: row?.initial_questionnaire_uploaded_at ?? null,
    url:        signed.signedUrl,
  })
}

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

  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 })
  }
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type as AllowedPhotoMimeType)) {
    return NextResponse.json({ success: false, error: 'unsupported_media_type' }, { status: 415 })
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'file_too_large' }, { status: 400 })
  }

  const sb = getServiceClient()

  const { data: existingRow } = await sb
    .from('brain_customers')
    .select('initial_questionnaire_photo_path')
    .eq('id', customerId)
    .maybeSingle()
  const previousPath = (existingRow as CustomerRow | null)?.initial_questionnaire_photo_path ?? null

  const ext = PHOTO_MIME_EXTENSIONS[file.type as AllowedPhotoMimeType]
  const newPath = `initial-questionnaires/${customerId}/questionnaire.${ext}`

  const { error: uploadError } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(newPath, file, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  // 拡張子が変わった(例: 前回jpg→今回webp)場合、古いパスのオブジェクトが孤児化しない
  // よう削除する。失敗しても致命的ではない(古いファイルがStorageに残るだけ)ため、
  // エラーは無視する。
  if (previousPath && previousPath !== newPath) {
    await sb.storage.from(PHOTO_BUCKET).remove([previousPath]).catch(() => {})
  }

  const uploadedAt = new Date().toISOString()
  const { error: updateError } = await sb
    .from('brain_customers')
    .update({
      initial_questionnaire_photo_path:  newPath,
      initial_questionnaire_uploaded_at: uploadedAt,
    })
    .eq('id', customerId)

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  const { data: signed } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(newPath, SIGNED_URL_EXPIRY_DETAIL_SEC)

  return NextResponse.json({
    success:    true,
    path:       newPath,
    uploadedAt,
    url:        signed?.signedUrl ?? null,
  })
}

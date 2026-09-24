/**
 * PUT /api/customers/[id]/documents/[slot] — 「契約書・その他資料」写真枠の登録・差し替え
 *
 * slotは1〜4の整数のみ受け付ける(brain_customer_documentsのCHECK制約と同じ範囲)。
 * 常に上書き(1スロット1枚)。設計・認証パターンはinitial-questionnaire/route.tsと同一、
 * brain_customer_photos(ゴースト・比較ロジック)には一切関わらない独立テーブル。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
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

function parseSlot(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 4) return null
  return n
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slot: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id, slot: slotRaw } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const slot = parseSlot(slotRaw)
  if (slot === null) {
    return NextResponse.json({ success: false, error: 'invalid_slot' }, { status: 400 })
  }

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
    .from('brain_customer_documents')
    .select('photo_path')
    .eq('customer_id', customerId)
    .eq('slot_index', slot)
    .maybeSingle()
  const previousPath = (existingRow as { photo_path: string } | null)?.photo_path ?? null

  const ext = PHOTO_MIME_EXTENSIONS[file.type as AllowedPhotoMimeType]
  const newPath = `documents/${customerId}/slot-${slot}.${ext}`

  const { error: uploadError } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(newPath, file, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  // 拡張子が変わった場合、古いパスのオブジェクトが孤児化しないよう削除する
  // (initial-questionnaire/route.tsと同じ方針。失敗しても致命的ではない)。
  if (previousPath && previousPath !== newPath) {
    await sb.storage.from(PHOTO_BUCKET).remove([previousPath]).catch(() => {})
  }

  const uploadedAt = new Date().toISOString()
  const { error: upsertError } = await sb
    .from('brain_customer_documents')
    .upsert(
      {
        customer_id: customerId,
        slot_index:  slot,
        photo_path:  newPath,
        uploaded_at: uploadedAt,
        updated_at:  uploadedAt,
        created_by:  staff.staffBrainId,
      },
      { onConflict: 'customer_id,slot_index' }
    )

  if (upsertError) {
    return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 })
  }

  const { data: signed } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(newPath, SIGNED_URL_EXPIRY_DETAIL_SEC)

  return NextResponse.json({
    success:    true,
    slotIndex:  slot,
    uploadedAt,
    url:        signed?.signedUrl ?? null,
  })
}

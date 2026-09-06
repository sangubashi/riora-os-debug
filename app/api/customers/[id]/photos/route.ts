/**
 * GET  /api/customers/[id]/photos — 写真カルテ一覧取得
 * POST /api/customers/[id]/photos — 写真アップロード
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 1節・2節
 * 認証: extractStaffFromRequest + canAccessCustomer(既存APIと同一パターン)
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { DEMO_STORE_ID } from '@/lib/constants'
import { getPhotoServiceClient } from '@/lib/photos/photoDb'
import { verifyVisitBelongsToCustomer } from '@/lib/photos/ownership'
import { commitCustomerPhoto } from '@/lib/photos/commitCustomerPhoto'
import { createSupabaseCommitCustomerPhotoRepo } from '@/lib/photos/commitCustomerPhotoRepo.supabase'
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTO_UPLOAD_BYTES,
  PHOTO_LIST_DEFAULT_LIMIT,
  PHOTO_LIST_MAX_LIMIT,
  PHOTO_LIST_ORDERS,
  PHOTO_TYPES,
  type AllowedPhotoMimeType,
  type PhotoListOrder,
  type PhotoType,
} from '@/lib/photos/constants'

interface PhotoRow {
  id:           string
  visit_id:     string | null
  body_part:    string
  photo_type:   string
  storage_path: string
  taken_at:     string
  created_by:   string | null
  created_at:   string
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

  const sp = req.nextUrl.searchParams
  const visitId    = sp.get('visitId')
  const bodyPart   = sp.get('bodyPart')
  const photoType  = sp.get('photoType')
  const cursor     = sp.get('cursor')
  const limitParam = sp.get('limit')
  const orderParam = sp.get('order')

  if (photoType && !PHOTO_TYPES.includes(photoType as PhotoType)) {
    return NextResponse.json({ success: false, error: 'invalid_photo_type' }, { status: 400 })
  }

  // R2追補: order省略時は既存の taken_at DESC を維持(後方互換、PHOTO_KARTE_API_DESIGN_1.md参照)
  if (orderParam && !PHOTO_LIST_ORDERS.includes(orderParam as PhotoListOrder)) {
    return NextResponse.json({ success: false, error: 'invalid_order' }, { status: 400 })
  }
  const ascending = orderParam === 'asc'

  let limit = PHOTO_LIST_DEFAULT_LIMIT
  if (limitParam) {
    const parsed = Number(limitParam)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ success: false, error: 'invalid_limit' }, { status: 400 })
    }
    limit = Math.min(parsed, PHOTO_LIST_MAX_LIMIT)
  }

  const supabase = getPhotoServiceClient()

  let query = supabase
    .from('brain_customer_photos')
    .select('id, visit_id, body_part, photo_type, storage_path, taken_at, created_by, created_at')
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('taken_at', { ascending })
    .limit(limit)

  if (visitId)   query = query.eq('visit_id', visitId)
  if (bodyPart)  query = query.eq('body_part', bodyPart)
  if (photoType) query = query.eq('photo_type', photoType)
  // order=asc時はcursorの意味も反転する(taken_atが指定値より新しいものを取得)。
  // order=desc(既定)は既存動作(taken_atが指定値より古いものを取得)を維持。
  if (cursor)    query = ascending ? query.gt('taken_at', cursor) : query.lt('taken_at', cursor)

  const { data: photos, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (photos ?? []) as PhotoRow[]

  // visit_id経由でvisit_date/visit_count_atを解決(既存visit-history.tsと同じ手動JOIN方式)
  const visitIds = Array.from(new Set(rows.map(r => r.visit_id).filter((v): v is string => !!v)))
  const { data: visits } = visitIds.length > 0
    ? await supabase.from('brain_visits').select('id, visit_date, visit_count_at, menu_id').in('id', visitIds)
    : { data: [] as Array<{ id: string; visit_date: string; visit_count_at: number; menu_id: string | null }> }

  // menu_id経由でmenuNameを解決(Photo Timeline表示用、既存visit-history.tsと同じ手動JOIN方式)。
  // 既存の visitId/visitDate/visitCountAt には影響しない純粋な追加フィールド。
  const menuIds = Array.from(new Set((visits ?? []).map(v => v.menu_id).filter((v): v is string => !!v)))
  const { data: menus } = menuIds.length > 0
    ? await supabase.from('brain_menus').select('id, name').in('id', menuIds)
    : { data: [] as Array<{ id: string; name: string }> }

  const visitMap = new Map((visits ?? []).map(v => [v.id, v]))
  const menuMap  = new Map((menus ?? []).map(m => [m.id, m.name]))

  const result = rows.map(r => {
    const visit = r.visit_id ? visitMap.get(r.visit_id) : undefined
    return {
      id:           r.id,
      visitId:      r.visit_id,
      visitDate:    visit?.visit_date ?? null,
      visitCountAt: visit?.visit_count_at ?? null,
      menuName:     visit?.menu_id ? menuMap.get(visit.menu_id) ?? null : null,
      bodyPart:     r.body_part,
      photoType:    r.photo_type,
      storagePath:  r.storage_path,
      takenAt:      r.taken_at,
      createdBy:    r.created_by,
      createdAt:    r.created_at,
    }
  })

  const nextCursor = rows.length === limit ? rows[rows.length - 1]?.taken_at ?? null : null

  return NextResponse.json({ success: true, photos: result, nextCursor })
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

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_form_data' }, { status: 400 })
  }

  const file             = form.get('file')
  const visitIdRaw       = form.get('visitId')
  const bodyPart         = form.get('bodyPart')
  const photoType        = form.get('photoType')
  const takenAtRaw       = form.get('takenAt')
  const clientRequestId  = form.get('clientRequestId')

  if (
    !(file instanceof Blob) ||
    typeof bodyPart !== 'string' || bodyPart.trim().length === 0 ||
    typeof photoType !== 'string' ||
    typeof clientRequestId !== 'string' || clientRequestId.trim().length === 0
  ) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 })
  }

  if (!PHOTO_TYPES.includes(photoType as PhotoType)) {
    return NextResponse.json({ success: false, error: 'invalid_photo_type' }, { status: 400 })
  }

  // クライアントから受け取ったファイル名の拡張子は信用せず、実際のMIME(file.type)
  // のみを検証する(WebP/JPEGフォールバック対応、iOS SafariのWebP非対応判明後の改訂)。
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type as AllowedPhotoMimeType)) {
    return NextResponse.json({ success: false, error: 'unsupported_media_type' }, { status: 415 })
  }

  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'file_too_large' }, { status: 400 })
  }

  const visitId = typeof visitIdRaw === 'string' && visitIdRaw.trim().length > 0 ? visitIdRaw : null
  const takenAt = typeof takenAtRaw === 'string' && takenAtRaw.trim().length > 0
    ? takenAtRaw
    : new Date().toISOString()

  // ── 認可: この顧客にアクセス可能か ──
  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  // ── visitIdが指定されている場合、対象customerに属することをサーバー側で検証 ──
  if (visitId) {
    const belongs = await verifyVisitBelongsToCustomer(visitId, customerId)
    if (!belongs) {
      return NextResponse.json({ success: false, error: 'invalid_visit_id' }, { status: 400 })
    }
  }

  const repo   = createSupabaseCommitCustomerPhotoRepo()
  const result = await commitCustomerPhoto(repo, {
    // store_idはクライアントから受け取らず、サーバー側の固定値を使用
    // (PHOTO_KARTE_API_DESIGN_1.md 5節・DEMO_STORE_ID、単一店舗運用)
    storeId:    DEMO_STORE_ID,
    customerId,
    visitId,
    bodyPart:   bodyPart.trim(),
    photoType:  photoType as PhotoType,
    takenAt,
    // created_by はクライアントから受け取らず、JWTから解決したstaffBrainIdのみを使用
    // (auth.users.idではなくbrain_staff.id、PHOTO_KARTE_API_DESIGN_1.md 5-1節)
    createdBy:  staff.staffBrainId,
    file,
  }, clientRequestId)

  if (!result.ok) {
    return NextResponse.json({ success: false, reason: result.reason }, { status: 500 })
  }

  return NextResponse.json({
    success:    true,
    idempotent: result.idempotent,
    photoId:    result.photo.id,
    storagePath: result.photo.storagePath,
  })
}

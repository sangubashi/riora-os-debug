/**
 * POST /api/customers/[id]/photos/signed-urls — バッチsigned URL発行
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 4節。
 * 一覧・比較表示でのN+1リクエスト問題を避けるための新設エンドポイント。
 * photoIds全件についてcustomer_id所有権を一括確認し、1件でも不一致があれば
 * 部分成功を返さず403とする(IDORの試行を明確に拒否する)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyPhotosOwnership } from '@/lib/photos/ownership'
import { issueSignedUrlsForPhotos } from '@/lib/photos/signedUrl'
import { BATCH_SIGNED_URL_MAX_IDS, type SignedUrlPurpose } from '@/lib/photos/constants'

interface RequestBody {
  photoIds?: string[]
  purpose?:  string
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

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  const photoIds = Array.isArray(body.photoIds)
    ? body.photoIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : []

  if (photoIds.length === 0) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 })
  }
  if (photoIds.length > BATCH_SIGNED_URL_MAX_IDS) {
    return NextResponse.json({ success: false, error: 'too_many_ids' }, { status: 400 })
  }

  const purpose: SignedUrlPurpose = body.purpose === 'thumbnail' ? 'thumbnail' : 'detail'

  const owned = await verifyPhotosOwnership(photoIds, customerId)
  if (!owned) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  try {
    const urls = await issueSignedUrlsForPhotos(owned, purpose)
    return NextResponse.json({ success: true, urls })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

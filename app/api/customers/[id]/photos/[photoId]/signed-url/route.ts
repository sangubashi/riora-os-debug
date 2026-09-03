/**
 * GET /api/customers/[id]/photos/[photoId]/signed-url — 単一signed URL発行
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 4節。
 * バッチAPI(signed-urls)の単一版を呼ぶ薄いラッパー。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyPhotoOwnership } from '@/lib/photos/ownership'
import { issueSignedUrlsForPhotos } from '@/lib/photos/signedUrl'
import type { SignedUrlPurpose } from '@/lib/photos/constants'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id, photoId } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const photoIdResult = idSchema.safeParse(photoId)
  if (!photoIdResult.success) {
    return NextResponse.json(toValidationErrorResponse(photoIdResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const owned = await verifyPhotoOwnership(photoIdResult.data, customerId)
  if (!owned) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const purposeParam = req.nextUrl.searchParams.get('purpose')
  const purpose: SignedUrlPurpose = purposeParam === 'thumbnail' ? 'thumbnail' : 'detail'

  try {
    const urls = await issueSignedUrlsForPhotos([owned], purpose)
    const entry = urls[owned.id]
    if (!entry) {
      return NextResponse.json({ success: false, error: 'signed_url_failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true, url: entry.url, expiresAt: entry.expiresAt })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

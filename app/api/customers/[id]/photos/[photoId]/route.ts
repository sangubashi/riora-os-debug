/**
 * DELETE /api/customers/[id]/photos/[photoId] — 写真の論理削除
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 3節
 * customer_id所有権確認: 操作対象の写真が要求元customer_idに属すること。
 * 不一致・存在しない場合は403を返す(customer-memoriesの既存慣行に合わせる)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { getPhotoServiceClient } from '@/lib/photos/photoDb'
import { verifyPhotoOwnership } from '@/lib/photos/ownership'

export async function DELETE(
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

  const supabase = getPhotoServiceClient()
  const { error } = await supabase
    .from('brain_customer_photos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', owned.id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}

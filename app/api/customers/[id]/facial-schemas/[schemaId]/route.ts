/**
 * DELETE /api/customers/[id]/facial-schemas/[schemaId] — 顔シェーマ記録のソフトデリート
 *
 * 設計: 実装計画(顔シェーマ機能READ ONLY設計・Phase 0、2026-09-21)。
 * app/api/customers/[id]/photos/[photoId]/route.ts のDELETEと同じパターン
 * (認証→認可→所有権確認→論理削除)を踏襲する。所有権不一致は404ではなく403を返す
 * (customer-memories/写真の既存慣行に合わせる、IDORの存在有無を漏らさないため)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { verifyFacialSchemaOwnership } from '@/lib/facialSchema/verifyFacialSchemaOwnership'
import { getFacialSchemaServiceClient } from '@/lib/facialSchema/facialSchemaDb'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; schemaId: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id, schemaId } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const schemaIdResult = idSchema.safeParse(schemaId)
  if (!schemaIdResult.success) {
    return NextResponse.json(toValidationErrorResponse(schemaIdResult.error), { status: 400 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const owned = await verifyFacialSchemaOwnership(schemaIdResult.data, customerId)
  if (!owned) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const supabase = getFacialSchemaServiceClient()
  const { error } = await supabase
    .from('brain_customer_facial_schemas')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', owned.id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}

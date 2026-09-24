/**
 * GET /api/customers/[id]/documents — 「契約書・その他資料」写真枠(4枚)の一覧取得
 *
 * 設計: 2026-09-24ユーザー承認(顧客トップページ)。brain_customer_documents
 * (customer_id, slot_index 1〜4)の登録済み行についてsigned URLを発行して返す。
 * 未登録のスロットは配列に含まれない(フロント側で1〜4番のうち欠けている番号を
 * 「未登録」として扱う)。
 *
 * 認証・認可パターンは既存API(initial-questionnaire/route.ts)と同一。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { PHOTO_BUCKET, SIGNED_URL_EXPIRY_DETAIL_SEC } from '@/lib/photos/constants'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
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
    .from('brain_customer_documents')
    .select('slot_index, photo_path, uploaded_at')
    .eq('customer_id', customerId)
    .order('slot_index', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as { slot_index: number; photo_path: string; uploaded_at: string }[]

  const documents = await Promise.all(rows.map(async (row) => {
    const { data: signed } = await sb.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(row.photo_path, SIGNED_URL_EXPIRY_DETAIL_SEC)
    return {
      slotIndex:  row.slot_index,
      uploadedAt: row.uploaded_at,
      url:        signed?.signedUrl ?? null,
    }
  }))

  return NextResponse.json({ success: true, documents })
}

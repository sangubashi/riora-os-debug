/**
 * PATCH /api/customers/[id]/skin-tags
 *
 * brain_customers.skin_tags を更新する。service role 経由（RLS bypass）。
 * body: { skin_tags: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

const bodySchema = z.object({
  skin_tags: z.array(z.string()),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, id, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'skin_tags must be a string array' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('brain_customers')
    .update({ skin_tags: parsed.data.skin_tags })
    .eq('id', id)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ success: true })
}

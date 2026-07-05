/**
 * POST /api/admin/visits/reclassify-menus (Pass L-2)
 *
 * source='salonboard_import' の既存来店に対して改善済み menuResolver を再実行し、
 * menu_id のみを更新する。visit 内容(staff_id/amount/source 等)は変更しない。
 *
 * Request: multipart/form-data
 *   file    — 売上明細 CSV (Shift-JIS, 10 MB以内)
 *   storeId — 省略時は DEMO_STORE_ID
 *
 * Response:
 *   { success: true,  report: ReclassificationReport }
 *   { success: false, error: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '../../../../lib/repos'
import { DEMO_STORE_ID } from '@/lib/constants'
import { decodeCsvBuffer } from '@/lib/import/csvEncoding'
import { runMenuReclassification } from '@/lib/import/runMenuReclassification'
import { requireAdmin } from '@/lib/auth/requireAdmin'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_form_data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'file_required' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'file_too_large' }, { status: 400 })
  }

  const storeId = (form.get('storeId') as string | null) || DEMO_STORE_ID

  let repos
  try {
    repos = getRepos()
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const csvText = decodeCsvBuffer(buf)
    const report = await runMenuReclassification({ storeId, csvText }, repos)
    return NextResponse.json({ success: true, report })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

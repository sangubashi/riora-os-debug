/**
 * POST /api/admin/visits/reclassify-menus (Pass L-2)
 *
 * source='salonboard_import' の既存来店に対して改善済み menuResolver を再実行し、
 * menu_id のみを更新する。visit 内容(staff_id/amount/source 等)は変更しない。
 *
 * Request: multipart/form-data
 *   file                 — 売上明細 CSV (Shift-JIS, 10 MB以内)
 *   storeId              — 省略時は DEMO_STORE_ID
 *   recoverFallbackNames — 'true'/'false'。省略時はfalse(既存の通常再分類動作のみ、
 *                          PHASE CSV-RECOVERY-2で追加。省略時は本パラメータ追加前と
 *                          完全に同じ挙動)。
 *   dryRun               — 'true'/'false'。recoverFallbackNames='true'の場合のみ有効で、
 *                          省略時はtrue(まずdry-runのみ・書き込みなしでreport.detailsに
 *                          変更予定一覧を返す)。recoverFallbackNames未指定/'false'の場合は
 *                          このパラメータを無視し、既存どおり常に書き込む。
 *
 * Response:
 *   { success: true,  report: ReclassificationReport } // report.detailsが変更(予定)一覧
 *   { success: false, error: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '../../../../lib/repos'
import { DEMO_STORE_ID } from '@/lib/constants'
import { decodeCsvBuffer } from '@/lib/import/csvEncoding'
import { runMenuReclassification } from '@/lib/import/runMenuReclassification'
import { requireAdmin } from '@/lib/auth/requireAdmin'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** 'true'/'false'の文字列のみを解釈する。未指定・不正値はundefined(呼び出し先の既定値に委ねる)。 */
function parseOptionalBoolean(raw: FormDataEntryValue | null): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

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
  // PHASE CSV-RECOVERY-2: 両方とも省略可能。recoverFallbackNames省略時はfalse相当となり、
  // runMenuReclassification()側の仕様により既存の通常再分類動作と完全に同じ挙動になる
  // (dryRunの値も無視される)。
  const recoverFallbackNames = parseOptionalBoolean(form.get('recoverFallbackNames'))
  const dryRun = parseOptionalBoolean(form.get('dryRun'))

  let repos
  try {
    repos = getRepos()
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const csvText = decodeCsvBuffer(buf)
    const report = await runMenuReclassification(
      { storeId, csvText, recoverFallbackNames, dryRun },
      repos,
    )
    return NextResponse.json({ success: true, report })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

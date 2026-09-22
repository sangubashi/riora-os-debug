/**
 * POST /api/admin/menu/hotpepper-import/preview — Hot Pepper Beauty自動取込機能(dryRun)
 *
 * 2026-09-22ユーザー承認。Hot Pepperのクーポン・メニューページを取得し、現在の
 * brain_menusとの差分(新規/価格変更/名称一致バックフィル/掲載終了候補)を算出して返す。
 * DB書き込みは一切行わない(runHotpepperMenuSync()のdryRun:trueが保証する)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRepos } from '../../../../../lib/repos'
import { DEMO_STORE_ID, HOTPEPPER_MENU_URL } from '@/lib/constants'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { runHotpepperMenuSync } from '@/lib/menu/runHotpepperMenuSync'
import { toValidationErrorResponse } from '../../../../_schemas/common'

const bodySchema = z.object({
  storeId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
})

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  let body: unknown = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  let repos
  try {
    repos = getRepos()
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }

  try {
    const report = await runHotpepperMenuSync(
      {
        storeId: parsed.data.storeId || DEMO_STORE_ID,
        sourceUrl: parsed.data.sourceUrl || HOTPEPPER_MENU_URL,
        dryRun: true,
      },
      repos.menuRepo,
    )
    return NextResponse.json({ success: true, report })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

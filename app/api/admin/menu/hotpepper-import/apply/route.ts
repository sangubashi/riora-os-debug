/**
 * POST /api/admin/menu/hotpepper-import/apply — Hot Pepper Beauty自動取込機能(本適用)
 *
 * 2026-09-22ユーザー承認。管理者がプレビュー内容を確認したうえで呼び出す想定。
 * 「反映する」ボタン操作の時点でHot Pepperページを再取得・再差分算出してから書き込む
 * (プレビュー時点のスナップショットをクライアントから信頼して受け取らない設計。
 * runMenuReclassification.tsのdryRunパターンと同じ考え方: 常に最新状態を正として扱う)。
 * confirm:trueを必須にすることで、誤ってpreviewと同じ呼び出しのまま書き込まれることを防ぐ。
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
  confirm: z.literal(true),
})

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  let body: unknown
  try {
    body = await req.json()
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
        dryRun: false,
      },
      repos.menuRepo,
    )
    return NextResponse.json({ success: true, report })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

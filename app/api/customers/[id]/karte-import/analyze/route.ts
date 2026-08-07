/**
 * POST /api/customers/[id]/karte-import/analyze — Salon Boardカルテ原文のAI解析 (Phase1)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer（既存APIと同一パターン）
 * レート制限: claudeLimiter（Claude呼び出し系と同一の上限を適用）
 *
 * 【重要】このルートはDBへ一切書き込まない。analyzeKarteText()（DB非接触）を
 * 呼び出し、候補を返すだけ。保存は必ず別ルート（karte-import/commit）を
 * スタッフの確認・選択を経てから呼ぶこと（docs/CALTE_IMPORT_MVP_DESIGN.md §2.3）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { claudeLimiter } from '@/lib/rateLimit'
import { analyzeKarteText } from '@/lib/karteImport/analyzeKarteText'

interface RequestBody {
  rawText: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const rl = await claudeLimiter.limit(staff.authUserId)
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) } },
    )
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

  let body: Partial<RequestBody>
  try {
    body = await req.json() as Partial<RequestBody>
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  if (typeof body.rawText !== 'string' || body.rawText.trim().length === 0) {
    return NextResponse.json({ success: false, error: 'raw_text_required' }, { status: 400 })
  }

  const result = await analyzeKarteText(body.rawText)
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.reason }, { status: 503 })
  }

  return NextResponse.json({ success: true, extracted: result.extracted })
}

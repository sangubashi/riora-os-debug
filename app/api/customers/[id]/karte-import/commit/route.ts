/**
 * POST /api/customers/[id]/karte-import/commit — Salon Boardカルテの保存 (Phase1)
 *
 * commitKarteImport()（src/lib/karteImport/commitKarteImport.ts）を呼び出す唯一の
 * APIルート。karte_imports / customer_notes / contraindications への保存は
 * このルートを経由した commitKarteImport() 経由でのみ行われる。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer（既存APIと同一パターン）
 *
 * リクエストは review画面でスタッフが確認・選択した後にのみ送られる想定
 * （selectedNotes/selectedContraindicationsは空配列を許容する。rawTextのみ必須）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { commitKarteImport, type CommitKarteImportPayload } from '@/lib/karteImport/commitKarteImport'
import { createSupabaseCommitKarteImportRepo } from '@/lib/karteImport/commitKarteImportRepo.supabase'
import type { ContraindicationSeverity } from '@/types'

const VALID_SEVERITIES: ContraindicationSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

interface RequestBody {
  rawText:                    string
  selectedNotes?:               Array<{ content: string }>
  selectedContraindications?:   Array<{ title: string; description: string; severity: string }>
}

export async function POST(
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

  let body: Partial<RequestBody>
  try {
    body = await req.json() as Partial<RequestBody>
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  if (typeof body.rawText !== 'string' || body.rawText.trim().length === 0) {
    return NextResponse.json({ success: false, error: 'raw_text_required' }, { status: 400 })
  }

  const selectedNotes = Array.isArray(body.selectedNotes)
    ? body.selectedNotes
        .filter((n): n is { content: string } => typeof n?.content === 'string' && n.content.trim().length > 0)
        .map(n => ({ content: n.content.trim() }))
    : []

  const selectedContraindications = Array.isArray(body.selectedContraindications)
    ? body.selectedContraindications
        .filter((c): c is { title: string; description: string; severity: string } =>
          typeof c?.title === 'string' && c.title.trim().length > 0 &&
          VALID_SEVERITIES.includes(c.severity as ContraindicationSeverity))
        .map(c => ({
          title:       c.title.trim(),
          description: (c.description ?? '').trim(),
          severity:    c.severity as ContraindicationSeverity,
        }))
    : []

  const payload: CommitKarteImportPayload = {
    customerId,
    // staff_id は auth.users.id（customer_notes.staff_id / karte_imports.staff_id の FK と一致）
    staffId:  staff.authUserId,
    rawText:  body.rawText,
    selectedNotes,
    selectedContraindications,
  }

  const repo   = createSupabaseCommitKarteImportRepo()
  const result = await commitKarteImport(repo, payload)

  if (!result.ok) {
    return NextResponse.json(
      { success: false, reason: result.reason, karteImportId: result.karteImportId },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success:               true,
    karteImportId:         result.karteImportId,
    noteIds:                result.noteIds,
    contraindicationIds:    result.contraindicationIds,
  })
}

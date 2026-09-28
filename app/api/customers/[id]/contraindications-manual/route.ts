/**
 * PUT /api/customers/[id]/contraindications-manual — 重要事項の手動登録・編集
 * (2026-09-28ユーザー承認)。
 *
 * `/karte`のPIN保護スタッフモード(IpadStaffKarteView.tsx → ContraindicationEditModal.tsx)
 * 専用。スマホアプリ(CustomerBottomSheet.tsx、customer_notes/voice_notesのキーワード
 * 自動検出)に依存せず、既存16ルール(CONTRAINDICATION_RULES、src/lib/contraindication.ts)
 * のON/OFFチェックボックスと自由記述メモを直接保存する。
 *
 * このエンドポイントは既存の /api/customers/[id]/contraindications (GET/POST、
 * customer_notes/voice_notesからの自動生成用)には一切触れない独立した新規ファイル
 * とした。認証パターンは既存の /api/customers/[id]/birth-date と同一
 * (extractStaffFromRequest + canAccessCustomer + service_role client)。
 *
 * チェックボックスのON/OFFは「そのtitleの行が現在存在するか」のみを見て追加/削除する
 * (既存の削除(DELETE /api/contraindications/[id])と同じく、生成元がAI自動検出
 * (customer_notes/voice_notes)か手動かを問わず削除できる既存仕様を踏襲する。新たな
 * 制約は設けていない)。自由記述メモはcustomer_notesへの手動メモ(category=null、
 * CustomerBottomSheet.saveMemoと同じ形)として保存するのみで、キーワード再解析
 * (自動生成ロジック)は行わない(チェックボックスとメモの役割を分離する、という
 * ユーザー指定の仕様)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { CONTRAINDICATION_RULES } from '@/lib/contraindication'

const KNOWN_TITLES = new Set(CONTRAINDICATION_RULES.map(r => r.title))

const putBodySchema = z.object({
  selectedTitles: z.array(z.string()).max(CONTRAINDICATION_RULES.length),
  note:           z.string().nullable().optional(),
})

export async function PUT(
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

  let body: unknown = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = putBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  // 未知のtitleは無視する(既存16ルール以外を誤って追加できないようにする)。
  const selectedTitles = new Set(parsed.data.selectedTitles.filter(t => KNOWN_TITLES.has(t)))
  const note = (parsed.data.note ?? '').trim()

  const supabase = getServiceClient()

  const { data: existing } = await supabase
    .from('contraindications')
    .select('id, title')
    .eq('customer_id', customerId)

  const existingMap = new Map<string, string>(
    (existing ?? []).map((r: { id: string; title: string }) => [r.title, r.id])
  )

  const now = new Date().toISOString()

  for (const rule of CONTRAINDICATION_RULES) {
    const isSelected = selectedTitles.has(rule.title)
    const existingId = existingMap.get(rule.title)

    if (isSelected && !existingId) {
      await supabase.from('contraindications').insert({
        customer_id:    customerId,
        reservation_id: null,
        store_id:       null,
        severity:       rule.severity,
        title:          rule.title,
        description:    rule.description,
        recommendation: rule.recommendation,
        source:         'manual',
        source_note_id: null,
        confidence:     1,
        generated_at:   now,
      })
    } else if (!isSelected && existingId) {
      await supabase.from('contraindications').delete().eq('id', existingId)
    }
  }

  if (note) {
    await supabase.from('customer_notes').insert({
      customer_id: customerId,
      staff_id:    staff.staffBrainId,
      note,
      created_at:  now,
    })
  }

  return NextResponse.json({ success: true })
}

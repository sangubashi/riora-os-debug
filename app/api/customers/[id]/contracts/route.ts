/**
 * /api/customers/[id]/contracts — 契約書・申込書(サブスクリプション申込書・回数券購入申込書)
 *
 * POST: 入力内容+署名PNGを受け取り、サーバー側で検証・金額再計算・content_hash生成・A4 PDF生成を行い、
 *       契約書専用バケット(customer-contracts)へPDFと署名PNGを保存し、brain_customer_contractsへ追記する。
 *       保存済みの契約書は更新・削除しない(追記のみ。UPDATE/DELETE用のAPIは存在しない)。
 * GET:  顧客の契約書履歴(新しい順)。PDFの署名付きURLと、content_hashの再計算による整合性(integrityOk)を返す。
 *
 * 認証・認可は既存API(documents/[slot]/route.ts等)と同じ extractStaffFromRequest → canAccessCustomer。
 * 担当者は、店舗共通ログイン時のみ resolveStaffIdOverride で選択済み担当者に置き換える。
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { resolveStaffIdOverride } from '@/lib/staffTag/resolveStaffIdOverride'
import { SIGNED_URL_EXPIRY_DETAIL_SEC } from '@/lib/photos/constants'
import {
  CONTRACT_BUCKET, CONTRACT_SIGNATURE_MAX_BYTES, CONTRACT_TEMPLATE_VERSION, isContractDocumentType,
  type ContractFormValues, type ContractLineInput, type ContractLineItem,
} from '@/lib/contracts/contractTypes'
import { validateContractInput } from '@/lib/contracts/contractCalc'
import { computeContentHash, sha256Hex } from '@/lib/contracts/contentHash'
import { buildContractPdf } from '@/lib/contracts/buildContractPdf'

export const runtime = 'nodejs'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)
}

interface ContractRow {
  id:               string
  document_type:    'subscription' | 'ticket'
  application_date: string
  name:             string
  address:          string
  phone_number:     string
  line_items:       ContractLineItem[]
  total_amount:     number
  pdf_path:         string
  signature_sha256: string
  content_hash:     string
  template_version: number
  created_at:       string
}

function parseLines(raw: unknown): ContractLineInput[] | null {
  if (!Array.isArray(raw)) return null
  const out: ContractLineInput[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null
    const o = r as Record<string, unknown>
    const courseId = o.courseId === null || o.courseId === undefined || o.courseId === '' ? null
      : typeof o.courseId === 'string' ? o.courseId : undefined
    if (courseId === undefined) return null
    const quantity = o.quantity === null || o.quantity === undefined ? null
      : typeof o.quantity === 'number' ? o.quantity : undefined
    if (quantity === undefined) return null
    if (o.note !== undefined && typeof o.note !== 'string') return null
    out.push({ courseId, quantity, note: (o.note as string | undefined) ?? '' })
  }
  return out
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_form_data' }, { status: 400 })
  }

  // ── 入力 ──────────────────────────────────────────
  const payloadRaw = form.get('payload')
  const signatureFile = form.get('signature')
  if (typeof payloadRaw !== 'string' || !(signatureFile instanceof Blob)) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 })
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_payload' }, { status: 400 })
  }

  const lines = parseLines(payload.lines)
  if (
    !isContractDocumentType(payload.documentType) || !lines
    || typeof payload.applicationDate !== 'string' || typeof payload.name !== 'string'
    || typeof payload.address !== 'string' || typeof payload.phoneNumber !== 'string'
  ) {
    return NextResponse.json({ success: false, error: 'invalid_payload' }, { status: 400 })
  }
  const formValues: ContractFormValues = {
    documentType: payload.documentType, applicationDate: payload.applicationDate,
    name: payload.name, address: payload.address, phoneNumber: payload.phoneNumber, lines,
  }
  const validated = validateContractInput(formValues)
  if (!validated.ok) {
    return NextResponse.json({ success: false, error: 'validation_error', code: validated.error }, { status: 400 })
  }
  const v = validated.value

  if (signatureFile.type !== 'image/png') {
    return NextResponse.json({ success: false, error: 'unsupported_media_type' }, { status: 415 })
  }
  if (signatureFile.size > CONTRACT_SIGNATURE_MAX_BYTES) {
    return NextResponse.json({ success: false, error: 'file_too_large' }, { status: 400 })
  }
  const signaturePng = new Uint8Array(await signatureFile.arrayBuffer())
  if (!isPng(signaturePng)) {
    return NextResponse.json({ success: false, error: 'invalid_signature' }, { status: 400 })
  }

  const sb = getServiceClient()

  const override = await resolveStaffIdOverride(
    sb, staff, typeof payload.staffId === 'string' ? payload.staffId : null,
  )
  const createdBy = override?.staffBrainId ?? staff.staffBrainId

  // ── ハッシュ・PDF ─────────────────────────────────
  const contractId = randomUUID()
  const signatureSha256 = sha256Hex(signaturePng)
  const contentHash = computeContentHash({
    documentType: v.documentType, applicationDate: v.applicationDate, name: v.name, address: v.address,
    phoneNumber: v.phoneNumber, lineItems: v.items, totalAmount: v.total, signatureSha256,
  })

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await buildContractPdf({
      contractId, documentType: v.documentType, applicationDate: v.applicationDate, name: v.name,
      address: v.address, phoneNumber: v.phoneNumber, items: v.items, total: v.total,
      signaturePng, contentHash,
    })
  } catch {
    return NextResponse.json({ success: false, error: 'pdf_generation_failed' }, { status: 500 })
  }
  const pdfSha256 = sha256Hex(pdfBytes)

  // ── Storage(上書き不可: 同じパスが既にあれば失敗させる) ──
  const pdfPath = `${customerId}/${contractId}.pdf`
  const signaturePath = `${customerId}/${contractId}-signature.png`

  const { error: pdfErr } = await sb.storage.from(CONTRACT_BUCKET)
    .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false })
  if (pdfErr) {
    return NextResponse.json({ success: false, error: pdfErr.message }, { status: 500 })
  }
  const { error: sigErr } = await sb.storage.from(CONTRACT_BUCKET)
    .upload(signaturePath, signaturePng, { contentType: 'image/png', upsert: false })
  if (sigErr) {
    await sb.storage.from(CONTRACT_BUCKET).remove([pdfPath]).catch(() => {})
    return NextResponse.json({ success: false, error: sigErr.message }, { status: 500 })
  }

  // ── DB(追記のみ) ─────────────────────────────────
  const { data: inserted, error: insErr } = await sb
    .from('brain_customer_contracts')
    .insert({
      id: contractId, customer_id: customerId, document_type: v.documentType,
      application_date: v.applicationDate, name: v.name, address: v.address, phone_number: v.phoneNumber,
      line_items: v.items, total_amount: v.total, pdf_path: pdfPath, signature_path: signaturePath,
      signature_sha256: signatureSha256, pdf_sha256: pdfSha256, content_hash: contentHash,
      template_version: CONTRACT_TEMPLATE_VERSION, created_by: createdBy,
    })
    .select('id, created_at')
    .single()

  if (insErr || !inserted) {
    // 孤児ファイルを残さない(DBに行が無ければ履歴にも出ないため)
    await sb.storage.from(CONTRACT_BUCKET).remove([pdfPath, signaturePath]).catch(() => {})
    return NextResponse.json({ success: false, error: insErr?.message ?? 'insert_failed' }, { status: 500 })
  }

  const { data: signed } = await sb.storage.from(CONTRACT_BUCKET)
    .createSignedUrl(pdfPath, SIGNED_URL_EXPIRY_DETAIL_SEC)

  return NextResponse.json({
    success: true,
    contract: {
      id:              contractId,
      documentType:    v.documentType,
      applicationDate: v.applicationDate,
      totalAmount:     v.total,
      createdAt:       (inserted as { created_at: string }).created_at,
      pdfUrl:          signed?.signedUrl ?? null,
    },
  }, { status: 201 })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
    .from('brain_customer_contracts')
    .select('id, document_type, application_date, name, address, phone_number, line_items, total_amount, pdf_path, signature_sha256, content_hash, template_version, created_at')
    .eq('customer_id', customerId)
    .order('application_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as ContractRow[]
  const contracts = await Promise.all(rows.map(async (row) => {
    const { data: signed } = await sb.storage.from(CONTRACT_BUCKET)
      .createSignedUrl(row.pdf_path, SIGNED_URL_EXPIRY_DETAIL_SEC)
    const recomputed = computeContentHash({
      documentType: row.document_type, applicationDate: row.application_date, name: row.name,
      address: row.address, phoneNumber: row.phone_number, lineItems: row.line_items,
      totalAmount: row.total_amount, signatureSha256: row.signature_sha256,
      templateVersion: row.template_version,
    })
    return {
      id:              row.id,
      documentType:    row.document_type,
      applicationDate: row.application_date,
      totalAmount:     row.total_amount,
      createdAt:       row.created_at,
      pdfUrl:          signed?.signedUrl ?? null,
      integrityOk:     recomputed === row.content_hash,
    }
  }))

  return NextResponse.json({ success: true, contracts })
}

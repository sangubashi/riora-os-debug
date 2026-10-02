// /api/customers/[id]/contracts — 契約書・申込書の保存(POST)と履歴(GET)
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../src/lib/staffTag/resolveStaffIdOverride', () => ({ resolveStaffIdOverride: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))

import { createClient } from '@supabase/supabase-js'
import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { resolveStaffIdOverride } from '../../src/lib/staffTag/resolveStaffIdOverride'
import { computeContentHash } from '../../src/lib/contracts/contentHash'
import { GET, POST } from '../../app/api/customers/[id]/contracts/route'

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const STAFF: RequestingStaff = { authUserId: 'u', staffBrainId: 'brain-staff-1', email: 'e@example.com', isAdmin: false }

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

interface Recorder {
  uploads: Array<{ path: string; contentType: string; upsert: boolean; size: number; bytes: Uint8Array }>
  removed: string[][]
  inserted: Record<string, unknown>[]
  failUpload?: (path: string) => boolean
  failInsert?: boolean
  rows?: unknown[]
}

function installFakeSupabase(rec: Recorder) {
  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn(async (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }) => {
        if (rec.failUpload?.(path)) return { error: { message: 'upload_failed' } }
        rec.uploads.push({ path, contentType: opts.contentType, upsert: opts.upsert, size: body.length, bytes: body })
        return { error: null }
      }),
      remove: vi.fn(async (paths: string[]) => { rec.removed.push(paths); return { error: null } }),
      createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` } })),
    })),
  }
  const table = {
    insert: vi.fn((row: Record<string, unknown>) => {
      rec.inserted.push(row)
      return {
        select: () => ({
          single: async () => rec.failInsert
            ? { data: null, error: { message: 'insert_failed' } }
            : { data: { id: row.id, created_at: '2026-10-02T00:00:00Z' }, error: null },
        }),
      }
    }),
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.order = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rec.rows ?? [], error: null }).then(resolve)
      return chain
    }),
  }
  vi.mocked(createClient).mockReturnValue({ from: vi.fn(() => table), storage } as never)
}

const validPayload = (over: Record<string, unknown> = {}) => ({
  documentType: 'subscription', applicationDate: '2026-10-02', name: '山田 花子',
  address: '東京都中央区新富1-1-1', phoneNumber: '090-1234-5678',
  lines: [
    { courseId: 'sub-hsc-basic', quantity: 2, note: '' },
    { courseId: null, quantity: null, note: '' },
  ],
  ...over,
})

function post(payload: unknown, opts: { signature?: Blob | null } = {}) {
  const fd = new FormData()
  fd.set('payload', JSON.stringify(payload))
  const sig = opts.signature === undefined ? new Blob([PNG_1X1], { type: 'image/png' }) : opts.signature
  if (sig) fd.set('signature', sig, 'signature.png')
  const req = new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/contracts`, { method: 'POST', body: fd })
  return POST(req, { params: Promise.resolve({ id: CUSTOMER_ID }) })
}

let rec: Recorder
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  rec = { uploads: [], removed: [], inserted: [] }
  installFakeSupabase(rec)
  vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
  vi.mocked(canAccessCustomer).mockResolvedValue(true)
  vi.mocked(resolveStaffIdOverride).mockResolvedValue(null)
})
afterEach(() => vi.clearAllMocks())

describe('POST /api/customers/[id]/contracts', () => {
  it('未認証は401、アクセス権なしは403(保存処理に進まない)', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    expect((await post(validPayload())).status).toBe(401)
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    expect((await post(validPayload())).status).toBe(403)
    expect(rec.uploads).toHaveLength(0)
    expect(rec.inserted).toHaveLength(0)
  })

  it('入力不備は400、署名なし/PNG以外は拒否(何も保存しない)', async () => {
    expect((await post(validPayload({ name: '' }))).status).toBe(400)
    expect((await post(validPayload({ lines: [{ courseId: null, quantity: null, note: '' }] }))).status).toBe(400)
    expect((await post(validPayload(), { signature: null })).status).toBe(400)
    expect((await post(validPayload(), { signature: new Blob(['x'], { type: 'image/jpeg' }) })).status).toBe(415)
    expect((await post(validPayload(), { signature: new Blob(['not a png at all'], { type: 'image/png' }) })).status).toBe(400)
    expect(rec.uploads).toHaveLength(0)
    expect(rec.inserted).toHaveLength(0)
  })

  it('クライアントが送った金額・単価は無視し、マスターから再計算して保存する', async () => {
    const res = await post(validPayload({
      lines: [{ courseId: 'sub-hsc-basic', quantity: 2, note: 'メモ', unitPrice: 1, amount: 1 }],
      totalAmount: 1,
    }))
    expect(res.status).toBe(201)
    const row = rec.inserted[0]
    expect(row.line_items).toEqual([{ course_name: 'ヒト幹細胞ベーシック', unit_price: 13000, quantity: 2, amount: 26000, note: 'メモ' }])
    expect(row.total_amount).toBe(26000)
  })

  it('コース未選択の行は数量が残っていても保存データ・合計に入らない', async () => {
    const res = await post(validPayload({ lines: [
      { courseId: null, quantity: 7, note: '' },
      { courseId: 'sub-skin', quantity: 1, note: '' },
    ] }))
    expect(res.status).toBe(201)
    expect(rec.inserted[0].line_items).toEqual([{ course_name: '選べる肌改善コース', unit_price: 16000, quantity: 1, amount: 16000, note: '' }])
    expect(rec.inserted[0].total_amount).toBe(16000)
  })

  it('正常系: 顧客ID配下のPDFと署名を上書き不可で保存し、content_hashつきで追記する', async () => {
    const res = await post(validPayload({ documentType: 'ticket', lines: [
      { courseId: 'tkt-hsc-basic-3', quantity: 1, note: '' },
      { courseId: 'tkt-nyuushi-3', quantity: 2, note: '' },
    ] }))
    expect(res.status).toBe(201)
    const json = await res.json() as { contract: { id: string; totalAmount: number; pdfUrl: string } }
    expect(json.contract.totalAmount).toBe(42000 + 49900 * 2)

    expect(rec.uploads).toHaveLength(2)
    const pdf = rec.uploads.find(u => u.contentType === 'application/pdf')!
    const sig = rec.uploads.find(u => u.contentType === 'image/png')!
    expect(pdf.path).toBe(`${CUSTOMER_ID}/${json.contract.id}.pdf`)
    expect(sig.path).toBe(`${CUSTOMER_ID}/${json.contract.id}-signature.png`)
    expect(pdf.upsert).toBe(false)
    expect(sig.upsert).toBe(false)
    const doc = await PDFDocument.load(pdf.bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getTitle()).toBe('回数券購入申込書')

    const row = rec.inserted[0]
    expect(row).toMatchObject({
      id: json.contract.id, customer_id: CUSTOMER_ID, document_type: 'ticket', application_date: '2026-10-02',
      name: '山田 花子', created_by: 'brain-staff-1', pdf_path: pdf.path, signature_path: sig.path,
    })
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(json.contract.pdfUrl).toContain(pdf.path)
  })

  it('店舗共通ログインで選択された担当者があれば created_by に使う', async () => {
    vi.mocked(resolveStaffIdOverride).mockResolvedValue({ staffBrainId: 'tagged-staff', authUserId: 'x' })
    await post(validPayload({ staffId: 'tagged-staff' }))
    expect(rec.inserted[0].created_by).toBe('tagged-staff')
  })

  it('DB追記に失敗したらアップロード済みファイルを消して500', async () => {
    rec.failInsert = true
    const res = await post(validPayload())
    expect(res.status).toBe(500)
    expect(rec.removed).toHaveLength(1)
    expect(rec.removed[0]).toHaveLength(2)
  })

  it('署名のアップロードに失敗したらPDFも消す', async () => {
    rec.failUpload = p => p.endsWith('-signature.png')
    const res = await post(validPayload())
    expect(res.status).toBe(500)
    expect(rec.removed[0]).toHaveLength(1)
    expect(rec.inserted).toHaveLength(0)
  })
})

describe('GET /api/customers/[id]/contracts', () => {
  const baseRow = () => {
    const line_items = [{ course_name: 'ヒト幹細胞ベーシック', unit_price: 13000, quantity: 1, amount: 13000, note: '' }]
    const row = {
      id: 'c1', document_type: 'subscription', application_date: '2026-09-26', name: 'A', address: 'B',
      phone_number: '1', line_items, total_amount: 13000, pdf_path: `${CUSTOMER_ID}/c1.pdf`,
      signature_sha256: 'f'.repeat(64), content_hash: '', template_version: 1, created_at: '2026-09-26T00:00:00Z',
    }
    row.content_hash = computeContentHash({
      documentType: 'subscription', applicationDate: row.application_date, name: row.name, address: row.address,
      phoneNumber: row.phone_number, lineItems: line_items, totalAmount: 13000, signatureSha256: row.signature_sha256,
      templateVersion: row.template_version, // 行が持つ版(この行は版1)で再計算される
    })
    return row
  }
  const get = () => GET(
    new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/contracts`),
    { params: Promise.resolve({ id: CUSTOMER_ID }) },
  )

  it('未認証401 / 権限なし403', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    expect((await get()).status).toBe(403)
  })

  it('履歴にPDFの署名付きURLと整合性(integrityOk)を返し、改ざんがあればfalse', async () => {
    const ok = baseRow()
    const tampered = { ...baseRow(), id: 'c2', total_amount: 99999, pdf_path: `${CUSTOMER_ID}/c2.pdf` }
    rec.rows = [ok, tampered]
    const json = await (await get()).json() as { contracts: Array<{ id: string; integrityOk: boolean; pdfUrl: string; totalAmount: number }> }
    expect(json.contracts.map(c => [c.id, c.integrityOk])).toEqual([['c1', true], ['c2', false]])
    expect(json.contracts[0].pdfUrl).toContain('c1.pdf')
  })
})

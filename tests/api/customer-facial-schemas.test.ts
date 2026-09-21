// ================================================================
// GET/PUT /api/customers/[id]/facial-schemas ルートレベル受入テスト
//
// 実装計画(顔シェーマ機能READ ONLY設計・Phase 0、2026-09-21)Phase 3に対応:
//   - 未認証/認可なしを拒否する(401/403、supabaseに一切触れない)
//   - GET: schema_date DESCで履歴一覧を返し、strokes_dataを安全にパースする
//   - PUT: visitIdの所属確認(400)・upsert(新規/既存)・担当者上書き・
//     部分ユニークインデックス競合(23505)時のフォールバックを検証する
//
// extractStaffFromRequest / canAccessCustomer / verifyVisitBelongsToCustomer /
// resolveStaffIdOverride の4箇所をモックし、route.ts本体・facialSchemaApiMapping.ts・
// strokeModel.ts・facialSchemaSelection.tsは実コードをそのまま実行する
// (customer-photos-upload.test.tsと同じ方針)。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({
  extractStaffFromRequest: vi.fn(),
}))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({
  canAccessCustomer: vi.fn(),
}))
vi.mock('../../src/lib/photos/ownership', () => ({
  verifyVisitBelongsToCustomer: vi.fn(),
}))
vi.mock('../../src/lib/staffTag/resolveStaffIdOverride', () => ({
  resolveStaffIdOverride: vi.fn(),
}))
vi.mock('../../src/lib/facialSchema/facialSchemaDb', () => ({
  getFacialSchemaServiceClient: vi.fn(),
}))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { verifyVisitBelongsToCustomer } from '../../src/lib/photos/ownership'
import { resolveStaffIdOverride } from '../../src/lib/staffTag/resolveStaffIdOverride'
import { getFacialSchemaServiceClient } from '../../src/lib/facialSchema/facialSchemaDb'
import { GET, PUT } from '../../app/api/customers/[id]/facial-schemas/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockVerifyVisit  = vi.mocked(verifyVisitBelongsToCustomer)
const mockResolveStaff = vi.mocked(resolveStaffIdOverride)
const mockGetClient    = vi.mocked(getFacialSchemaServiceClient)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

type FakeResult = { data?: unknown; error?: unknown }

/**
 * .from()を呼ぶたびに、渡した配列の先頭から順に1件ずつ結果を消費するフェイクSupabase。
 * PUT側は1リクエスト内で複数回.from()する(既存機会の検索→insert or update)ため、
 * 呼び出し順に結果を割り当てられるようにしている。
 */
function createSequencedFakeSupabase(sequence: FakeResult[]) {
  let callIndex = 0
  const chainMethods = ['select', 'eq', 'is', 'order', 'insert', 'update']

  function chainable(result: FakeResult) {
    const obj: Record<string, unknown> = {}
    for (const m of chainMethods) obj[m] = vi.fn(() => obj)
    obj.maybeSingle = vi.fn(async () => result)
    obj.single = vi.fn(async () => result)
    obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return obj
  }

  const from = vi.fn(() => {
    const result = sequence[callIndex] ?? { data: null, error: null }
    callIndex++
    return chainable(result)
  })

  return { from }
}

function callGet(customerId: string) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/facial-schemas`)
  return GET(req, { params: Promise.resolve({ id: customerId }) })
}

function callPut(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/facial-schemas`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return PUT(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/customers/[id]/facial-schemas', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await callGet('customer-a')
    expect(res.status).toBe(401)
    expect(mockCanAccess).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await callGet('customer-forbidden')
    expect(res.status).toBe(403)
  })

  it('正常系: schema_date DESCの履歴一覧を返し、strokes_dataを安全にパースする', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createSequencedFakeSupabase([
      {
        data: [
          {
            id: 'schema-2', visit_id: null, schema_date: '2026-09-06', template_key: 'face_front',
            strokes_data: { version: 1, strokes: [] }, created_by: 'staff-1', updated_by: 'staff-1',
            created_at: '2026-09-06T00:00:00Z', updated_at: '2026-09-06T00:00:00Z',
          },
          {
            id: 'schema-1', visit_id: 'visit-1', schema_date: '2026-08-01', template_key: 'face_front',
            // 壊れたversionのデータでも空のstrokesへフォールバックし、リクエスト全体は失敗させない
            strokes_data: { version: 999, strokes: [{ id: 'x' }] }, created_by: null, updated_by: null,
            created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
          },
        ],
        error: null,
      },
    ]) as never)

    const res  = await callGet('customer-a')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.schemas).toHaveLength(2)
    expect(body.schemas[0]).toMatchObject({ id: 'schema-2', visitId: null, schemaDate: '2026-09-06' })
    expect(body.schemas[0].strokesData).toEqual({ version: 1, strokes: [] })
    // version不一致は空のstrokesDataへフォールバックする(strokeModel.tsのparseStrokesData)
    expect(body.schemas[1].strokesData).toEqual({ version: 1, strokes: [] })
  })

  it('DBエラー時は500を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createSequencedFakeSupabase([
      { data: null, error: { message: 'db down' } },
    ]) as never)

    const res = await callGet('customer-a')
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/customers/[id]/facial-schemas', () => {
  const validBody = { visitId: null, strokesData: { version: 1, strokes: [] } }

  it('未認証は401を返し、visit所属確認・supabaseに一切触れない', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await callPut('customer-a', validBody)
    expect(res.status).toBe(401)
    expect(mockVerifyVisit).not.toHaveBeenCalled()
    expect(mockGetClient).not.toHaveBeenCalled()
  })

  it('不正なJSONの場合は400を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    const req = new NextRequest('http://localhost/api/customers/customer-a/facial-schemas', {
      method: 'PUT', body: '{invalid json',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'customer-a' }) })
    expect(res.status).toBe(400)
  })

  it('visitIdが空文字列の場合はvalidation_errorで400を返す(nullは許容)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    const res = await callPut('customer-a', { visitId: '', strokesData: {} })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await callPut('customer-forbidden', validBody)
    expect(res.status).toBe(403)
    expect(mockVerifyVisit).not.toHaveBeenCalled()
  })

  it('visitIdが対象customerに属さない場合はinvalid_visit_idで400を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)

    const res  = await callPut('customer-a', { visitId: 'visit-other', strokesData: {} })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
    expect(mockGetClient).not.toHaveBeenCalled()
  })

  it('新規: 既存の機会が無い場合はINSERTしてcreated=trueを返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockResolveStaff.mockResolvedValue(null) // 個人ログイン、上書き無し

    mockGetClient.mockReturnValue(createSequencedFakeSupabase([
      { data: null, error: null }, // 1回目: 既存機会の検索 → 見つからない
      {
        data: {
          id: 'schema-new', visit_id: null, schema_date: '2026-09-21', template_key: 'face_front',
          strokes_data: { version: 1, strokes: [] }, created_by: 'brain-staff-1', updated_by: 'brain-staff-1',
          created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
        },
        error: null,
      }, // 2回目: INSERT
    ]) as never)

    const res  = await callPut('customer-a', validBody)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.created).toBe(true)
    expect(body.schema).toMatchObject({ id: 'schema-new', createdBy: 'brain-staff-1', updatedBy: 'brain-staff-1' })
  })

  it('更新: 既存の機会がある場合はUPDATEしてcreated=falseを返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockResolveStaff.mockResolvedValue(null)

    mockGetClient.mockReturnValue(createSequencedFakeSupabase([
      { data: { id: 'schema-existing' }, error: null }, // 1回目: 既存機会が見つかる
      {
        data: {
          id: 'schema-existing', visit_id: null, schema_date: '2026-09-21', template_key: 'face_front',
          strokes_data: { version: 1, strokes: [] }, created_by: 'brain-staff-1', updated_by: 'brain-staff-1',
          created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
        },
        error: null,
      }, // 2回目: UPDATE
    ]) as never)

    const res  = await callPut('customer-a', validBody)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.created).toBe(false)
    expect(body.schema.id).toBe('schema-existing')
  })

  it('店舗共通ログイン時: 担当者上書きがcreated_by/updated_byに反映される(resolveStaffIdOverride経由)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockResolveStaff.mockResolvedValue({ staffBrainId: 'overridden-staff', authUserId: 'overridden-auth' })

    const fake = createSequencedFakeSupabase([
      { data: null, error: null },
      {
        data: {
          id: 'schema-new', visit_id: null, schema_date: '2026-09-21', template_key: 'face_front',
          strokes_data: { version: 1, strokes: [] }, created_by: 'overridden-staff', updated_by: 'overridden-staff',
          created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
        },
        error: null,
      },
    ])
    mockGetClient.mockReturnValue(fake as never)

    const res  = await callPut('customer-a', { ...validBody, staffId: 'tagged-staff' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.schema.createdBy).toBe('overridden-staff')
    expect(mockResolveStaff).toHaveBeenCalledWith(expect.anything(), STAFF, 'tagged-staff')
  })

  it('INSERT時に部分ユニークインデックス競合(23505)が起きた場合、既存行を再取得してUPDATEへフォールバックする', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockResolveStaff.mockResolvedValue(null)

    mockGetClient.mockReturnValue(createSequencedFakeSupabase([
      { data: null, error: null },                                 // 1回目: 既存機会の検索 → 見つからない(実際には直後に競合発生)
      { data: null, error: { code: '23505', message: 'duplicate' } }, // 2回目: INSERT → ユニーク制約違反
      { data: { id: 'schema-raced' }, error: null },               // 3回目: 再検索 → 競合相手の行が見つかる
      {
        data: {
          id: 'schema-raced', visit_id: null, schema_date: '2026-09-21', template_key: 'face_front',
          strokes_data: { version: 1, strokes: [] }, created_by: 'brain-staff-1', updated_by: 'brain-staff-1',
          created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
        },
        error: null,
      }, // 4回目: UPDATE
    ]) as never)

    const res  = await callPut('customer-a', validBody)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.created).toBe(false)
    expect(body.schema.id).toBe('schema-raced')
  })

  it('INSERT時に23505以外のエラーが起きた場合は500を返す(フォールバックしない)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockResolveStaff.mockResolvedValue(null)

    mockGetClient.mockReturnValue(createSequencedFakeSupabase([
      { data: null, error: null },
      { data: null, error: { code: '99999', message: 'unexpected' } },
    ]) as never)

    const res = await callPut('customer-a', validBody)
    expect(res.status).toBe(500)
  })
})

// ================================================================
// GET/POST /api/customers/[id]/skin-records ルートレベル受入テスト
//
// デジタル顧客カルテ Phase1-A: brain_skin_records(既存テーブル)のGET/POST。
// visit_id は NOT NULL UNIQUE のため、POST は upsert(既存行があれば部分更新、
// 無ければ新規作成)として実装している点を中心に検証する。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'
import { createFakeSupabase } from './_helpers/fakeSupabase'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../app/lib/repos', () => ({ getServiceClient: vi.fn() }))
vi.mock('../../src/lib/customerKarte/ownership', () => ({ verifyVisitBelongsToCustomer: vi.fn() }))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { getServiceClient } from '../../app/lib/repos'
import { verifyVisitBelongsToCustomer } from '../../src/lib/customerKarte/ownership'
import { GET, POST } from '../../app/api/customers/[id]/skin-records/route'

const mockExtractStaff  = vi.mocked(extractStaffFromRequest)
const mockCanAccess     = vi.mocked(canAccessCustomer)
const mockGetClient     = vi.mocked(getServiceClient)
const mockVerifyVisit   = vi.mocked(verifyVisitBelongsToCustomer)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function getRoute(customerId: string, qs = '') {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/skin-records${qs}`)
  return GET(req, { params: Promise.resolve({ id: customerId }) })
}

function postRoute(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/skin-records`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => vi.clearAllMocks())

describe('GET /api/customers/[id]/skin-records', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await getRoute('cust-1')
    expect(res.status).toBe(401)
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await getRoute('cust-1')
    expect(res.status).toBe(403)
  })

  it('正常系: 記録一覧をcreated_at降順で返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({
      brain_skin_records: {
        data: [{
          id: 'sr-1', customer_id: 'cust-1', visit_id: 'visit-1',
          acne_level: 2, pore_level: null, dryness_level: 3, redness_level: null,
          sagging_level: null, dullness_level: null, firmness_level: null,
          primary_delta: null, created_at: '2026-09-07T00:00:00Z',
        }],
        error: null,
      },
    }) as never)

    const res  = await getRoute('cust-1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.records).toEqual([{
      id: 'sr-1', visitId: 'visit-1', acneLevel: 2, poreLevel: null, drynessLevel: 3,
      rednessLevel: null, saggingLevel: null, dullnessLevel: null, firmnessLevel: null,
      primaryDelta: null, createdAt: '2026-09-07T00:00:00Z',
    }])
  })
})

describe('POST /api/customers/[id]/skin-records', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await postRoute('cust-1', { visitId: 'visit-1', acneLevel: 2 })
    expect(res.status).toBe(401)
  })

  it('visitId欠落は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await postRoute('cust-1', { acneLevel: 2 })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('level項目が1つも無い場合は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await postRoute('cust-1', { visitId: 'visit-1' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('level値が範囲外(0〜5)の場合は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await postRoute('cust-1', { visitId: 'visit-1', acneLevel: 6 })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('visitIdが対象customerに属さない場合は400(invalid_visit_id)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)
    const res  = await postRoute('cust-1', { visitId: 'visit-x', acneLevel: 2 })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
  })

  it('既存行が無い場合はINSERTする(新規作成、201)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    const fake = createFakeSupabase({
      brain_skin_records: [
        { data: null, error: null }, // 既存行検索(findExisting)
        {
          data: {
            id: 'sr-new', customer_id: 'cust-1', visit_id: 'visit-1',
            acne_level: 2, pore_level: null, dryness_level: null, redness_level: null,
            sagging_level: null, dullness_level: null, firmness_level: null,
            primary_delta: null, created_at: '2026-09-07T00:00:00Z',
          },
          error: null,
        }, // insert結果
      ],
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await postRoute('cust-1', { visitId: 'visit-1', acneLevel: 2 })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.record.acneLevel).toBe(2)
    expect(fake.chainFor('brain_skin_records', 1).insert).toHaveBeenCalledWith({
      customer_id: 'cust-1', visit_id: 'visit-1', acne_level: 2,
    })
  })

  it('既存行がある場合はUPDATEする(部分マージ、200)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    const fake = createFakeSupabase({
      brain_skin_records: [
        { data: { id: 'sr-1' }, error: null }, // 既存行あり
        {
          data: {
            id: 'sr-1', customer_id: 'cust-1', visit_id: 'visit-1',
            acne_level: 3, pore_level: 1, dryness_level: null, redness_level: null,
            sagging_level: null, dullness_level: null, firmness_level: null,
            primary_delta: null, created_at: '2026-09-07T00:00:00Z',
          },
          error: null,
        }, // update結果
      ],
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await postRoute('cust-1', { visitId: 'visit-1', acneLevel: 3, poreLevel: 1 })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.record).toMatchObject({ id: 'sr-1', acneLevel: 3, poreLevel: 1 })
    expect(fake.chainFor('brain_skin_records', 1).update).toHaveBeenCalledWith({
      acne_level: 3, pore_level: 1,
    })
  })
})

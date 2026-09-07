// ================================================================
// GET/POST /api/customers/[id]/product-proposals ルートレベル受入テスト
//
// デジタル顧客カルテ Phase1-A: brain_product_proposals(新設)。
// staffIdはクライアント入力を信用せずBearerトークンから解決したstaffBrainIdを使うこと、
// resultがenum外の場合に拒否されることを中心に検証する。
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
import { GET, POST } from '../../app/api/customers/[id]/product-proposals/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockGetClient    = vi.mocked(getServiceClient)
const mockVerifyVisit  = vi.mocked(verifyVisitBelongsToCustomer)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function getRoute(customerId: string) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/product-proposals`)
  return GET(req, { params: Promise.resolve({ id: customerId }) })
}

function postRoute(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/product-proposals`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => vi.clearAllMocks())

describe('GET /api/customers/[id]/product-proposals', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await getRoute('cust-1')
    expect(res.status).toBe(401)
  })

  it('正常系: 提案一覧を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({
      brain_product_proposals: {
        data: [{ id: 'pp-1', customer_id: 'cust-1', visit_id: 'visit-1', product_name: '美容液', result: 'considering', staff_id: 'brain-staff-1', created_at: '2026-09-07T00:00:00Z' }],
        error: null,
      },
    }) as never)

    const res  = await getRoute('cust-1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.proposals).toEqual([{
      id: 'pp-1', visitId: 'visit-1', productName: '美容液', result: 'considering',
      staffId: 'brain-staff-1', createdAt: '2026-09-07T00:00:00Z',
    }])
  })
})

describe('POST /api/customers/[id]/product-proposals', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await postRoute('cust-1', { productName: '美容液', result: 'considering' })
    expect(res.status).toBe(401)
  })

  it('productName欠落は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await postRoute('cust-1', { result: 'considering' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('resultが不正な値(enum外)の場合は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await postRoute('cust-1', { productName: '美容液', result: 'bought' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('visitIdが対象customerに属さない場合は400(invalid_visit_id)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)
    const res  = await postRoute('cust-1', { visitId: 'visit-x', productName: '美容液', result: 'considering' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
  })

  it('正常系: staffIdはBearerトークンから解決した値で保存する(client供給値を信用しない)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    const fake = createFakeSupabase({
      brain_product_proposals: {
        data: { id: 'pp-new', customer_id: 'cust-1', visit_id: 'visit-1', product_name: '美容液', result: 'considering', staff_id: 'brain-staff-1', created_at: '2026-09-07T00:00:00Z' },
        error: null,
      },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await postRoute('cust-1', {
      visitId: 'visit-1', productName: '美容液', result: 'considering', staffId: 'someone-else',
    })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.proposal.staffId).toBe('brain-staff-1')
    expect(fake.chainFor('brain_product_proposals').insert).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'brain-staff-1', result: 'considering', product_name: '美容液' })
    )
  })
})

// ================================================================
// GET/PATCH /api/customers/[id]/visits/[visitId]/treatment ルートレベル受入テスト
//
// デジタル顧客カルテ Phase1-A: brain_visits に追加した4列
// (options/products_used/machine_settings/treatment_memo)のみを対象とする。
// menu_id/treatment_amount/retail_amount等の既存列には一切触れないことを確認する。
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
import { GET, PATCH } from '../../app/api/customers/[id]/visits/[visitId]/treatment/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockGetClient    = vi.mocked(getServiceClient)
const mockVerifyVisit  = vi.mocked(verifyVisitBelongsToCustomer)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function getRoute(customerId: string, visitId: string) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/visits/${visitId}/treatment`)
  return GET(req, { params: Promise.resolve({ id: customerId, visitId }) })
}

function patchRoute(customerId: string, visitId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/visits/${visitId}/treatment`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ id: customerId, visitId }) })
}

afterEach(() => vi.clearAllMocks())

describe('GET /api/customers/[id]/visits/[visitId]/treatment', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await getRoute('cust-1', 'visit-1')
    expect(res.status).toBe(401)
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await getRoute('cust-1', 'visit-1')
    expect(res.status).toBe(403)
  })

  it('visitIdが対象customerに属さない場合は400(invalid_visit_id)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)
    const res  = await getRoute('cust-1', 'visit-x')
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
  })

  it('存在しないvisitは404を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({ brain_visits: { data: null, error: null } }) as never)
    const res = await getRoute('cust-1', 'visit-1')
    expect(res.status).toBe(404)
  })

  it('正常系: 施術記録4列を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({
      brain_visits: {
        data: { id: 'visit-1', options: ['毛穴集中'], products_used: ['ローション'], machine_settings: { level: 3 }, treatment_memo: '順調' },
        error: null,
      },
    }) as never)

    const res  = await getRoute('cust-1', 'visit-1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.treatment).toEqual({
      visitId: 'visit-1', options: ['毛穴集中'], productsUsed: ['ローション'],
      machineSettings: { level: 3 }, treatmentMemo: '順調',
    })
  })
})

describe('PATCH /api/customers/[id]/visits/[visitId]/treatment', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await patchRoute('cust-1', 'visit-1', { treatmentMemo: 'test' })
    expect(res.status).toBe(401)
  })

  it('フィールドが1つも無い場合は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await patchRoute('cust-1', 'visit-1', {})
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('visitIdが対象customerに属さない場合は400(invalid_visit_id)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)
    const res  = await patchRoute('cust-1', 'visit-x', { treatmentMemo: 'test' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
  })

  it('正常系: 指定フィールドのみUPDATEする(menu_id等の既存列には触れない)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    const fake = createFakeSupabase({
      brain_visits: {
        data: { id: 'visit-1', options: [], products_used: [], machine_settings: {}, treatment_memo: '順調' },
        error: null,
      },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await patchRoute('cust-1', 'visit-1', { treatmentMemo: '順調' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.treatment.treatmentMemo).toBe('順調')
    expect(fake.chainFor('brain_visits').update).toHaveBeenCalledWith({ treatment_memo: '順調' })
  })

  it('存在しないvisitは404を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({ brain_visits: { data: null, error: null } }) as never)
    const res = await patchRoute('cust-1', 'visit-1', { treatmentMemo: 'test' })
    expect(res.status).toBe(404)
  })
})

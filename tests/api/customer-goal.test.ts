// ================================================================
// GET/PATCH /api/customers/[id]/goal ルートレベル受入テスト
//
// デジタル顧客カルテ Phase1-A: brain_customers.goal_note のGET/PATCH。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'
import { createFakeSupabase } from './_helpers/fakeSupabase'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../app/lib/repos', () => ({ getServiceClient: vi.fn() }))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { getServiceClient } from '../../app/lib/repos'
import { GET, PATCH } from '../../app/api/customers/[id]/goal/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockGetClient    = vi.mocked(getServiceClient)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function getRoute(customerId: string) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/goal`)
  return GET(req, { params: Promise.resolve({ id: customerId }) })
}

function patchRoute(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/goal`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => vi.clearAllMocks())

describe('GET /api/customers/[id]/goal', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await getRoute('cust-1')
    expect(res.status).toBe(401)
    expect(mockCanAccess).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await getRoute('cust-1')
    expect(res.status).toBe(403)
  })

  it('存在しない顧客は404を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(
      createFakeSupabase({ brain_customers: { data: null, error: null } }) as never
    )
    const res = await getRoute('cust-1')
    expect(res.status).toBe(404)
  })

  it('正常系: goalNoteを返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(
      createFakeSupabase({ brain_customers: { data: { goal_note: '結婚式までに毛穴を改善したい' }, error: null } }) as never
    )
    const res  = await getRoute('cust-1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, goalNote: '結婚式までに毛穴を改善したい' })
  })
})

describe('PATCH /api/customers/[id]/goal', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await patchRoute('cust-1', { goalNote: 'test' })
    expect(res.status).toBe(401)
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await patchRoute('cust-1', { goalNote: 'test' })
    expect(res.status).toBe(403)
  })

  it('不正なJSONは400を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res = await patchRoute('cust-1', 'not-json')
    expect(res.status).toBe(400)
  })

  it('goalNoteが長すぎる場合は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await patchRoute('cust-1', { goalNote: 'a'.repeat(1001) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('空文字はNULLに正規化してUPDATEする', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const fake = createFakeSupabase({ brain_customers: { data: { id: 'cust-1' }, error: null } })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await patchRoute('cust-1', { goalNote: '' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, goalNote: null })
    expect(fake.chainFor('brain_customers').update).toHaveBeenCalledWith({ goal_note: null })
  })

  it('正常系: goalNoteを更新する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const fake = createFakeSupabase({ brain_customers: { data: { id: 'cust-1' }, error: null } })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await patchRoute('cust-1', { goalNote: '毛穴・肌質を改善したい' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, goalNote: '毛穴・肌質を改善したい' })
    expect(fake.chainFor('brain_customers').update).toHaveBeenCalledWith({ goal_note: '毛穴・肌質を改善したい' })
  })

  it('存在しない顧客は404を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(
      createFakeSupabase({ brain_customers: { data: null, error: null } }) as never
    )
    const res = await patchRoute('cust-1', { goalNote: 'test' })
    expect(res.status).toBe(404)
  })
})

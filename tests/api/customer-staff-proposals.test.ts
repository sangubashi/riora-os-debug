// ================================================================
// GET/POST /api/customers/[id]/staff-proposals
// PATCH   /api/customers/[id]/staff-proposals/[proposalId]
// ルートレベル受入テスト
//
// デジタル顧客カルテ Phase1-A: brain_staff_proposals(新設)。
// AI提案候補からの自動コピーが無いこと(bodyで受け取ったproposalTextのみ保存)、
// 新規作成時は常にstatus='proposed'固定であることを中心に検証する。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'
import { createFakeSupabase } from './_helpers/fakeSupabase'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../app/lib/repos', () => ({ getServiceClient: vi.fn() }))
vi.mock('../../src/lib/customerKarte/ownership', () => ({
  verifyVisitBelongsToCustomer: vi.fn(),
  verifyStaffProposalBelongsToCustomer: vi.fn(),
}))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { getServiceClient } from '../../app/lib/repos'
import { verifyVisitBelongsToCustomer, verifyStaffProposalBelongsToCustomer } from '../../src/lib/customerKarte/ownership'
import { GET, POST } from '../../app/api/customers/[id]/staff-proposals/route'
import { PATCH } from '../../app/api/customers/[id]/staff-proposals/[proposalId]/route'

const mockExtractStaff   = vi.mocked(extractStaffFromRequest)
const mockCanAccess      = vi.mocked(canAccessCustomer)
const mockGetClient      = vi.mocked(getServiceClient)
const mockVerifyVisit    = vi.mocked(verifyVisitBelongsToCustomer)
const mockVerifyProposal = vi.mocked(verifyStaffProposalBelongsToCustomer)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function getRoute(customerId: string) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/staff-proposals`)
  return GET(req, { params: Promise.resolve({ id: customerId }) })
}

function postRoute(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/staff-proposals`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id: customerId }) })
}

function patchRoute(customerId: string, proposalId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/staff-proposals/${proposalId}`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ id: customerId, proposalId }) })
}

afterEach(() => vi.clearAllMocks())

describe('GET /api/customers/[id]/staff-proposals', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await getRoute('cust-1')
    expect(res.status).toBe(401)
  })

  it('正常系: 提案履歴一覧を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({
      brain_staff_proposals: {
        data: [{ id: 'sp-1', customer_id: 'cust-1', visit_id: 'visit-1', staff_id: 'brain-staff-1', proposal_text: '毛穴集中コース、3週間後', status: 'proposed', created_at: '2026-09-07T00:00:00Z' }],
        error: null,
      },
    }) as never)

    const res  = await getRoute('cust-1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.proposals).toEqual([{
      id: 'sp-1', visitId: 'visit-1', staffId: 'brain-staff-1',
      proposalText: '毛穴集中コース、3週間後', status: 'proposed', createdAt: '2026-09-07T00:00:00Z',
    }])
  })
})

describe('POST /api/customers/[id]/staff-proposals', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await postRoute('cust-1', { proposalText: '毛穴集中コース' })
    expect(res.status).toBe(401)
  })

  it('proposalText欠落は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await postRoute('cust-1', {})
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('visitIdが対象customerに属さない場合は400(invalid_visit_id)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)
    const res  = await postRoute('cust-1', { visitId: 'visit-x', proposalText: '毛穴集中コース' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
  })

  it('正常系: status=proposed固定・staffIdはBearerトークンから解決した値で新規作成する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    const fake = createFakeSupabase({
      brain_staff_proposals: {
        data: { id: 'sp-new', customer_id: 'cust-1', visit_id: 'visit-1', staff_id: 'brain-staff-1', proposal_text: '毛穴集中コース、3週間後', status: 'proposed', created_at: '2026-09-07T00:00:00Z' },
        error: null,
      },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await postRoute('cust-1', { visitId: 'visit-1', proposalText: '毛穴集中コース、3週間後', status: 'executed' })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.proposal.status).toBe('proposed')
    expect(fake.chainFor('brain_staff_proposals').insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proposed', staff_id: 'brain-staff-1', proposal_text: '毛穴集中コース、3週間後' })
    )
  })
})

describe('PATCH /api/customers/[id]/staff-proposals/[proposalId]', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await patchRoute('cust-1', 'sp-1', { status: 'executed' })
    expect(res.status).toBe(401)
  })

  it('statusが不正な値(enum外)の場合は400(validation_error)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await patchRoute('cust-1', 'sp-1', { status: 'done' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('対象customerに属さない提案は404(proposal_not_found)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyProposal.mockResolvedValue(false)
    const res  = await patchRoute('cust-1', 'sp-x', { status: 'executed' })
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.error).toBe('proposal_not_found')
  })

  it('正常系: statusのみ更新する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyProposal.mockResolvedValue(true)
    const fake = createFakeSupabase({
      brain_staff_proposals: {
        data: { id: 'sp-1', customer_id: 'cust-1', visit_id: 'visit-1', staff_id: 'brain-staff-1', proposal_text: '毛穴集中コース', status: 'executed', created_at: '2026-09-07T00:00:00Z' },
        error: null,
      },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await patchRoute('cust-1', 'sp-1', { status: 'executed' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.proposal.status).toBe('executed')
    expect(fake.chainFor('brain_staff_proposals').update).toHaveBeenCalledWith({ status: 'executed' })
  })
})

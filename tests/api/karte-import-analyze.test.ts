import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../app/api/customers/[id]/karte-import/analyze/route'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { analyzeKarteText } from '@/lib/karteImport/analyzeKarteText'

vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('@/lib/karteImport/analyzeKarteText', () => ({ analyzeKarteText: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  claudeLimiter: { limit: vi.fn().mockResolvedValue({ success: true, limit: 20, remaining: 19, reset: Date.now() + 60_000 }) },
}))

const STAFF = { authUserId: 'staff-auth-uid', staffBrainId: 'staff-1', email: 'staff@example.com', isAdmin: false }
const CUSTOMER_ID = 'cust-1'

const EXTRACTED = {
  treatments: [{ content: '施術内容' }], skinCondition: [], concerns: [], precautions: [],
  contraindications: [], nextProposalCandidates: [], visitDateGuess: null,
}

function buildReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/karte-import/analyze`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function callRoute(body: unknown) {
  return POST(buildReq(body), { params: Promise.resolve({ id: CUSTOMER_ID }) })
}

describe('POST /api/customers/[id]/karte-import/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    vi.mocked(analyzeKarteText).mockResolvedValue({ ok: true, extracted: EXTRACTED })
  })

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    const res = await callRoute({ rawText: 'カルテ本文' })
    expect(res.status).toBe(401)
    expect(analyzeKarteText).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客の場合は403を返す', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    const res = await callRoute({ rawText: 'カルテ本文' })
    expect(res.status).toBe(403)
    expect(analyzeKarteText).not.toHaveBeenCalled()
  })

  it('rawText欠落の場合は400を返す', async () => {
    const res = await callRoute({})
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('raw_text_required')
    expect(analyzeKarteText).not.toHaveBeenCalled()
  })

  it('rawTextが空白のみの場合は400を返す', async () => {
    const res = await callRoute({ rawText: '   ' })
    expect(res.status).toBe(400)
  })

  it('不正なJSONの場合は400を返す', async () => {
    const res = await callRoute('not-json')
    expect(res.status).toBe(400)
  })

  it('正常系: analyzeKarteTextの結果をそのまま返す', async () => {
    const res = await callRoute({ rawText: 'カルテ本文' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, extracted: EXTRACTED })
    expect(analyzeKarteText).toHaveBeenCalledWith('カルテ本文')
  })

  it('analyzeKarteTextが失敗した場合は503を返す', async () => {
    vi.mocked(analyzeKarteText).mockResolvedValue({ ok: false, reason: 'claude_api_error:500' })
    const res = await callRoute({ rawText: 'カルテ本文' })
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toEqual({ success: false, error: 'claude_api_error:500' })
  })

  it('レート制限に達した場合は429を返す', async () => {
    const { claudeLimiter } = await import('@/lib/rateLimit')
    vi.mocked(claudeLimiter.limit).mockResolvedValue({ success: false, limit: 20, remaining: 0, reset: Date.now() + 60_000 } as never)

    const res = await callRoute({ rawText: 'カルテ本文' })
    expect(res.status).toBe(429)
    expect(analyzeKarteText).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../app/api/customers/[id]/karte-import/commit/route'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { commitKarteImport } from '@/lib/karteImport/commitKarteImport'
import { createSupabaseCommitKarteImportRepo } from '@/lib/karteImport/commitKarteImportRepo.supabase'

vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('@/lib/karteImport/commitKarteImport', () => ({ commitKarteImport: vi.fn() }))
vi.mock('@/lib/karteImport/commitKarteImportRepo.supabase', () => ({ createSupabaseCommitKarteImportRepo: vi.fn() }))

const STAFF = { authUserId: 'staff-auth-uid', staffBrainId: 'staff-1', email: 'staff@example.com', isAdmin: false }
const CUSTOMER_ID = 'cust-1'
const DUMMY_REPO = { insertRawText: vi.fn(), insertNotes: vi.fn(), insertContraindications: vi.fn() }

function buildReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/karte-import/commit`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function callRoute(body: unknown) {
  return POST(buildReq(body), { params: Promise.resolve({ id: CUSTOMER_ID }) })
}

const VALID_BODY = {
  rawText: 'カルテ原文',
  selectedNotes: [{ content: '施術内容メモ' }],
  selectedContraindications: [{ title: '妊娠中', description: '妊娠中のため一部施術禁忌', severity: 'HIGH' }],
}

describe('POST /api/customers/[id]/karte-import/commit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    vi.mocked(createSupabaseCommitKarteImportRepo).mockReturnValue(DUMMY_REPO as never)
    vi.mocked(commitKarteImport).mockResolvedValue({
      ok: true, karteImportId: 'ki-1', noteIds: ['note-1'], contraindicationIds: ['ci-1'],
    })
  })

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    const res = await callRoute(VALID_BODY)
    expect(res.status).toBe(401)
    expect(commitKarteImport).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客の場合は403を返す', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    const res = await callRoute(VALID_BODY)
    expect(res.status).toBe(403)
    expect(commitKarteImport).not.toHaveBeenCalled()
  })

  it('rawText欠落の場合は400を返す', async () => {
    const res = await callRoute({ selectedNotes: [], selectedContraindications: [] })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('raw_text_required')
    expect(commitKarteImport).not.toHaveBeenCalled()
  })

  it('不正なJSONの場合は400を返す', async () => {
    const res = await callRoute('not-json')
    expect(res.status).toBe(400)
  })

  it('正常系: 200を返しcommitKarteImportが正しいpayloadで呼ばれる', async () => {
    const res = await callRoute(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      success: true, karteImportId: 'ki-1', noteIds: ['note-1'], contraindicationIds: ['ci-1'],
    })
    expect(commitKarteImport).toHaveBeenCalledWith(DUMMY_REPO, {
      customerId: CUSTOMER_ID,
      staffId:    'staff-auth-uid',
      rawText:    'カルテ原文',
      selectedNotes: [{ content: '施術内容メモ' }],
      selectedContraindications: [{ title: '妊娠中', description: '妊娠中のため一部施術禁忌', severity: 'HIGH' }],
    })
  })

  it('selectedNotes/selectedContraindications省略時は空配列として扱う', async () => {
    const res = await callRoute({ rawText: 'カルテ原文' })
    expect(res.status).toBe(200)
    expect(commitKarteImport).toHaveBeenCalledWith(DUMMY_REPO, expect.objectContaining({
      selectedNotes: [], selectedContraindications: [],
    }))
  })

  it('不正なseverity値の禁忌候補は除外する', async () => {
    await callRoute({
      rawText: 'カルテ原文',
      selectedContraindications: [{ title: 'x', description: 'y', severity: 'INVALID' }],
    })
    expect(commitKarteImport).toHaveBeenCalledWith(DUMMY_REPO, expect.objectContaining({
      selectedContraindications: [],
    }))
  })

  it('titleが空文字のnote候補は除外する', async () => {
    await callRoute({ rawText: 'カルテ原文', selectedNotes: [{ content: '  ' }, { content: '有効' }] })
    expect(commitKarteImport).toHaveBeenCalledWith(DUMMY_REPO, expect.objectContaining({
      selectedNotes: [{ content: '有効' }],
    }))
  })

  it('commitKarteImportが失敗した場合は500を返す', async () => {
    vi.mocked(commitKarteImport).mockResolvedValue({ ok: false, reason: 'raw_text_save_failed:db down', karteImportId: null })
    const res = await callRoute(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ success: false, reason: 'raw_text_save_failed:db down', karteImportId: null })
  })
})

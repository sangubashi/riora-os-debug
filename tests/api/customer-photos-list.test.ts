// ================================================================
// GET /api/customers/[id]/photos ルートレベル受入テスト
//
// docs/PHOTO_KARTE_API_DESIGN_1.md 1節に対応:
//   - 未認証/認可なしを拒否する(401/403)
//   - visit_id経由でvisit_date/visit_count_atを解決して返す
//   - signed URLを含めない(storage_pathのみ返す)
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({
  extractStaffFromRequest: vi.fn(),
}))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({
  canAccessCustomer: vi.fn(),
}))
vi.mock('../../src/lib/photos/photoDb', () => ({
  getPhotoServiceClient: vi.fn(),
}))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { getPhotoServiceClient } from '../../src/lib/photos/photoDb'
import { GET } from '../../app/api/customers/[id]/photos/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockGetClient    = vi.mocked(getPhotoServiceClient)

const STAFF: RequestingStaff = {
  authUserId:   'auth-user-1',
  staffBrainId: 'brain-staff-1',
  email:        'staff@example.com',
  isAdmin:      false,
}

/** from(table) を呼ぶたびに resultsByTable[table] へ解決する最小限のチェイン可能フェイク */
function createFakeSupabase(resultsByTable: Record<string, { data?: unknown; error?: unknown }>) {
  const chainMethods = ['select', 'eq', 'is', 'order', 'limit', 'lt', 'gt', 'in', 'gte', 'lte', 'neq']

  function chainable(result: { data?: unknown; error?: unknown }) {
    const obj: Record<string, unknown> = {}
    for (const m of chainMethods) {
      obj[m] = vi.fn(() => obj)
    }
    obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return obj
  }

  return {
    from: vi.fn((table: string) => chainable(resultsByTable[table] ?? { data: [], error: null })),
  }
}

function callRoute(customerId: string, qs = '') {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/photos${qs}`)
  return GET(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/customers/[id]/photos', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await callRoute('customer-a')
    expect(res.status).toBe(401)
    expect(mockCanAccess).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await callRoute('customer-forbidden')
    expect(res.status).toBe(403)
  })

  it('不正なphotoTypeクエリは400を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res = await callRoute('customer-a', '?photoType=invalid')
    expect(res.status).toBe(400)
  })

  it('不正なorderクエリは400を返す(R2追補)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await callRoute('customer-a', '?order=ascending')
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_order')
  })

  it('正常系: 一覧を取得しvisit_id経由でvisitDate/visitCountAtを解決する。signed URLは含まない', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetClient.mockReturnValue(createFakeSupabase({
      brain_customer_photos: {
        data: [
          { id: 'photo-1', visit_id: 'visit-1', body_part: 'cheek_left', photo_type: 'after', storage_path: 's/c/photo-1.webp', taken_at: '2026-09-01T00:00:00Z', created_by: 'staff-1', created_at: '2026-09-01T00:00:00Z' },
          { id: 'photo-2', visit_id: null, body_part: 'nose', photo_type: 'progress', storage_path: 's/c/photo-2.webp', taken_at: '2026-08-01T00:00:00Z', created_by: null, created_at: '2026-08-01T00:00:00Z' },
        ],
        error: null,
      },
      brain_visits: {
        data: [{ id: 'visit-1', visit_date: '2026-09-01', visit_count_at: 3 }],
      },
    }) as never)

    const res  = await callRoute('customer-a')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.photos).toHaveLength(2)
    expect(body.photos[0]).toMatchObject({
      id: 'photo-1', visitId: 'visit-1', visitDate: '2026-09-01', visitCountAt: 3, storagePath: 's/c/photo-1.webp',
    })
    expect(body.photos[1]).toMatchObject({ id: 'photo-2', visitId: null, visitDate: null, visitCountAt: null })
    // signed URLはこのAPIでは発行しない(PHOTO_KARTE_API_DESIGN_1.md 1節)
    expect(body.photos[0].url).toBeUndefined()
    expect(body.photos[0].signedUrl).toBeUndefined()
  })
})

// ================================================================
// order=asc/desc(R2追補)
//
// 対応: docs/PHOTO_KARTE_API_DESIGN_1.md「API設計追補: GET /photos ソート順パラメータ」
//   docs/PHOTO_KARTE_UX_WIREFRAME_1.md 4節・6-5節(「初回」ゴースト取得に必要)
// ================================================================
describe('GET /api/customers/[id]/photos — order (R2追補)', () => {
  beforeEach(() => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
  })

  function setupFakeClient() {
    const fake = createFakeSupabase({ brain_customer_photos: { data: [], error: null } })
    mockGetClient.mockReturnValue(fake as never)
    return fake
  }

  /** 'brain_customer_photos' に対して呼ばれたチェイン可能クエリオブジェクトを取り出す */
  function photosChain(fake: ReturnType<typeof createFakeSupabase>) {
    const idx = fake.from.mock.calls.findIndex(call => call[0] === 'brain_customer_photos')
    return fake.from.mock.results[idx]!.value as Record<string, ReturnType<typeof vi.fn>>
  }

  it('order=asc は taken_at ASC(ascending:true)でクエリする', async () => {
    const fake = setupFakeClient()
    const res  = await callRoute('customer-a', '?order=asc')
    expect(res.status).toBe(200)
    expect(photosChain(fake).order).toHaveBeenCalledWith('taken_at', { ascending: true })
  })

  it('order=desc は既存動作(taken_at DESC・ascending:false)のまま変わらない', async () => {
    const fake = setupFakeClient()
    const res  = await callRoute('customer-a', '?order=desc')
    expect(res.status).toBe(200)
    expect(photosChain(fake).order).toHaveBeenCalledWith('taken_at', { ascending: false })
  })

  it('orderクエリ未指定は既存動作(desc相当・ascending:false)のまま変わらない', async () => {
    const fake = setupFakeClient()
    const res  = await callRoute('customer-a')
    expect(res.status).toBe(200)
    expect(photosChain(fake).order).toHaveBeenCalledWith('taken_at', { ascending: false })
  })

  it('不正なorder値(asc/desc以外)は400 invalid_orderを返す', async () => {
    const res  = await callRoute('customer-a', '?order=ascending')
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_order')
  })

  it('customerId/deleted_at/visitId/bodyPart/photoTypeの既存filterはorder=ascと併用しても壊れない', async () => {
    const fake = setupFakeClient()
    const res  = await callRoute(
      'customer-a',
      '?order=asc&visitId=visit-1&bodyPart=cheek_left&photoType=before'
    )
    expect(res.status).toBe(200)
    const chain = photosChain(fake)
    expect(chain.eq).toHaveBeenCalledWith('customer_id', 'customer-a')
    expect(chain.eq).toHaveBeenCalledWith('visit_id', 'visit-1')
    expect(chain.eq).toHaveBeenCalledWith('body_part', 'cheek_left')
    expect(chain.eq).toHaveBeenCalledWith('photo_type', 'before')
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null)
    expect(chain.order).toHaveBeenCalledWith('taken_at', { ascending: true })
  })

  it('order=desc(既定)でcursor併用時は既存動作どおりtaken_atより古いものをltで取得する', async () => {
    const fake = setupFakeClient()
    const res  = await callRoute('customer-a', '?cursor=2026-08-01T00:00:00Z')
    expect(res.status).toBe(200)
    const chain = photosChain(fake)
    expect(chain.lt).toHaveBeenCalledWith('taken_at', '2026-08-01T00:00:00Z')
    expect(chain.gt).not.toHaveBeenCalled()
  })

  it('order=ascでcursor併用時はtaken_atより新しいものをgtで取得する(意味を反転)', async () => {
    const fake = setupFakeClient()
    const res  = await callRoute('customer-a', '?order=asc&cursor=2026-08-01T00:00:00Z')
    expect(res.status).toBe(200)
    const chain = photosChain(fake)
    expect(chain.gt).toHaveBeenCalledWith('taken_at', '2026-08-01T00:00:00Z')
    expect(chain.lt).not.toHaveBeenCalled()
  })
})

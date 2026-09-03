// ================================================================
// signed URL発行ルートレベル受入テスト
//   GET  /api/customers/[id]/photos/[photoId]/signed-url (単一)
//   POST /api/customers/[id]/photos/signed-urls          (バッチ)
//
// docs/PHOTO_KARTE_API_DESIGN_1.md 4節に対応:
//   - 未認証/認可なしを拒否する(401/403)
//   - 所有権のないphotoIdは403で拒否する(IDOR防止)
//   - バッチAPIはphotoIdsが1件でも所有権不一致なら部分成功を返さず403にする
//   - photoIds上限(50件)超過は400
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
  verifyPhotoOwnership: vi.fn(),
  verifyPhotosOwnership: vi.fn(),
}))
vi.mock('../../src/lib/photos/signedUrl', () => ({
  issueSignedUrlsForPhotos: vi.fn(),
}))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { verifyPhotoOwnership, verifyPhotosOwnership } from '../../src/lib/photos/ownership'
import { issueSignedUrlsForPhotos } from '../../src/lib/photos/signedUrl'
import { GET as getSingleSignedUrl } from '../../app/api/customers/[id]/photos/[photoId]/signed-url/route'
import { POST as postBatchSignedUrls } from '../../app/api/customers/[id]/photos/signed-urls/route'

const mockExtractStaff  = vi.mocked(extractStaffFromRequest)
const mockCanAccess     = vi.mocked(canAccessCustomer)
const mockVerifyOwner   = vi.mocked(verifyPhotoOwnership)
const mockVerifyOwners  = vi.mocked(verifyPhotosOwnership)
const mockIssueUrls     = vi.mocked(issueSignedUrlsForPhotos)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function callSingle(customerId: string, photoId: string, qs = '') {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/photos/${photoId}/signed-url${qs}`)
  return getSingleSignedUrl(req, { params: Promise.resolve({ id: customerId, photoId }) })
}

function callBatch(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/photos/signed-urls`, {
    method: 'POST',
    body:   JSON.stringify(body),
  })
  return postBatchSignedUrls(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/customers/[id]/photos/[photoId]/signed-url', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await callSingle('customer-a', 'photo-1')
    expect(res.status).toBe(401)
  })

  it('所有権のないphotoIdは403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwner.mockResolvedValue(null)

    const res = await callSingle('customer-a', 'photo-of-other-customer')
    expect(res.status).toBe(403)
    expect(mockIssueUrls).not.toHaveBeenCalled()
  })

  it('正常系: signed URLとexpiresAtを返す(detail用途はvoice-notesと同水準の1時間)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwner.mockResolvedValue({ id: 'photo-1', storagePath: 's/c/photo-1.webp' })
    mockIssueUrls.mockResolvedValue({ 'photo-1': { url: 'https://signed.example/photo-1', expiresAt: '2026-09-02T11:00:00Z' } })

    const res  = await callSingle('customer-a', 'photo-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, url: 'https://signed.example/photo-1', expiresAt: '2026-09-02T11:00:00Z' })
    expect(mockIssueUrls).toHaveBeenCalledWith([{ id: 'photo-1', storagePath: 's/c/photo-1.webp' }], 'detail')
  })

  it('purpose=thumbnailを指定すると短い有効期限用の呼び出しになる', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwner.mockResolvedValue({ id: 'photo-1', storagePath: 's/c/photo-1.webp' })
    mockIssueUrls.mockResolvedValue({ 'photo-1': { url: 'https://signed.example/photo-1', expiresAt: 'x' } })

    await callSingle('customer-a', 'photo-1', '?purpose=thumbnail')

    expect(mockIssueUrls).toHaveBeenCalledWith(expect.anything(), 'thumbnail')
  })
})

describe('POST /api/customers/[id]/photos/signed-urls', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await callBatch('customer-a', { photoIds: ['photo-1'] })
    expect(res.status).toBe(401)
  })

  it('photoIds空配列は400を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res = await callBatch('customer-a', { photoIds: [] })
    expect(res.status).toBe(400)
  })

  it('photoIdsが50件を超える場合は400 too_many_idsを返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const res  = await callBatch('customer-a', { photoIds: Array.from({ length: 51 }, (_, i) => `photo-${i}`) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('too_many_ids')
  })

  it('1件でも他顧客のphotoIdが混ざっていれば部分成功を返さず403にする(IDOR防止)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwners.mockResolvedValue(null) // verifyPhotosOwnership: 1件でも不一致ならnull

    const res = await callBatch('customer-a', { photoIds: ['photo-1', 'photo-of-other-customer'] })

    expect(res.status).toBe(403)
    expect(mockIssueUrls).not.toHaveBeenCalled()
  })

  it('正常系: 所有権確認済みの写真全件についてsigned URLをまとめて返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwners.mockResolvedValue([
      { id: 'photo-1', storagePath: 's/c/photo-1.webp' },
      { id: 'photo-2', storagePath: 's/c/photo-2.webp' },
    ])
    mockIssueUrls.mockResolvedValue({
      'photo-1': { url: 'https://signed.example/1', expiresAt: 'x' },
      'photo-2': { url: 'https://signed.example/2', expiresAt: 'x' },
    })

    const res  = await callBatch('customer-a', { photoIds: ['photo-1', 'photo-2'] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Object.keys(body.urls)).toEqual(['photo-1', 'photo-2'])
  })
})

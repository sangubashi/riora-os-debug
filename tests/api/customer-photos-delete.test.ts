// ================================================================
// DELETE /api/customers/[id]/photos/[photoId] ルートレベル受入テスト
//
// docs/PHOTO_KARTE_API_DESIGN_1.md 3節に対応:
//   - 未認証/認可なしを拒否する(401/403)
//   - 他顧客のphotoIdを指定した場合(所有権不一致)は403で拒否する(IDOR防止)
//   - 正常系は論理削除(deleted_at更新)のみ行い204を返す
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
}))
vi.mock('../../src/lib/photos/photoDb', () => ({
  getPhotoServiceClient: vi.fn(),
}))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { verifyPhotoOwnership } from '../../src/lib/photos/ownership'
import { getPhotoServiceClient } from '../../src/lib/photos/photoDb'
import { DELETE } from '../../app/api/customers/[id]/photos/[photoId]/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockVerifyOwner  = vi.mocked(verifyPhotoOwnership)
const mockGetClient    = vi.mocked(getPhotoServiceClient)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

function fakeUpdateClient(updateSpy: (patch: unknown) => void) {
  const obj: Record<string, unknown> = {}
  obj.update = vi.fn((patch: unknown) => { updateSpy(patch); return obj })
  obj.eq = vi.fn(() => obj)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
  return { from: vi.fn(() => obj) }
}

function callRoute(customerId: string, photoId: string) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/photos/${photoId}`, { method: 'DELETE' })
  return DELETE(req, { params: Promise.resolve({ id: customerId, photoId }) })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/customers/[id]/photos/[photoId]', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await callRoute('customer-a', 'photo-1')
    expect(res.status).toBe(401)
    expect(mockVerifyOwner).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await callRoute('customer-forbidden', 'photo-1')
    expect(res.status).toBe(403)
    expect(mockVerifyOwner).not.toHaveBeenCalled()
  })

  it('他顧客のphotoId(所有権不一致)は403を返し、削除処理に進まない(IDOR防止)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwner.mockResolvedValue(null)

    const res = await callRoute('customer-a', 'photo-of-other-customer')

    expect(res.status).toBe(403)
    expect(mockGetClient).not.toHaveBeenCalled()
  })

  it('正常系: 論理削除(deleted_at更新)のみを行い204を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyOwner.mockResolvedValue({ id: 'photo-1', storagePath: 's/c/photo-1.webp' })

    let capturedPatch: unknown = null
    mockGetClient.mockReturnValue(fakeUpdateClient(p => { capturedPatch = p }) as never)

    const res = await callRoute('customer-a', 'photo-1')

    expect(res.status).toBe(204)
    expect(capturedPatch).toHaveProperty('deleted_at')
    expect(typeof (capturedPatch as { deleted_at: string }).deleted_at).toBe('string')
  })
})

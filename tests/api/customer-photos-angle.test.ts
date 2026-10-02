// PATCH /api/customers/[id]/photos/[photoId] — アングル修正(実体はbody_part)
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../src/lib/photos/ownership', () => ({ verifyPhotoOwnership: vi.fn() }))
vi.mock('../../src/lib/photos/photoDb', () => ({ getPhotoServiceClient: vi.fn() }))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { verifyPhotoOwnership } from '../../src/lib/photos/ownership'
import { getPhotoServiceClient } from '../../src/lib/photos/photoDb'
import { PATCH } from '../../app/api/customers/[id]/photos/[photoId]/route'

const STAFF: RequestingStaff = { authUserId: 'u', staffBrainId: 's', email: 'e@example.com', isAdmin: false }

function fakeUpdateClient(spy: (patch: unknown) => void) {
  const obj: Record<string, unknown> = {}
  obj.update = vi.fn((patch: unknown) => { spy(patch); return obj })
  obj.eq = vi.fn(() => obj)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
  return { from: vi.fn(() => obj) }
}

function call(body: unknown) {
  const req = new NextRequest('http://localhost/api/customers/c1/photos/p1', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ id: 'c1', photoId: 'p1' }) })
}

afterEach(() => vi.clearAllMocks())

describe('PATCH /api/customers/[id]/photos/[photoId]', () => {
  it('未認証は401', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    expect((await call({ angle: 'front' })).status).toBe(401)
  })
  it('不正なangleは400で更新に進まない', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
    expect((await call({ angle: 'face_front' })).status).toBe(400)
    expect(getPhotoServiceClient).not.toHaveBeenCalled()
  })
  it('他顧客の写真(所有権不一致)は403', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    vi.mocked(verifyPhotoOwnership).mockResolvedValue(null)
    expect((await call({ angle: 'left' })).status).toBe(403)
    expect(getPhotoServiceClient).not.toHaveBeenCalled()
  })
  it('正常系: angleに対応するbody_partへ更新する', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    vi.mocked(verifyPhotoOwnership).mockResolvedValue({ id: 'p1', storagePath: 'x' })
    let patch: unknown = null
    vi.mocked(getPhotoServiceClient).mockReturnValue(fakeUpdateClient(p => { patch = p }) as never)
    const res = await call({ angle: 'right' })
    expect(res.status).toBe(200)
    expect(patch).toEqual({ body_part: 'face_right' })
    expect(await res.json()).toEqual({ success: true, bodyPart: 'face_right' })
  })
})

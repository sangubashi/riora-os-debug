// ================================================================
// POST /api/customers/[id]/photos ルートレベル受入テスト
//
// docs/PHOTO_KARTE_API_DESIGN_1.md 2節・5-1節に対応:
//   - 未認証/認可なしを拒否する(401/403、repoに一切触れない)
//   - 必須フィールド欠落・不正MIME・サイズ超過を拒否する(400/415)
//   - visitIdが対象customerに属さない場合は拒否する(400)
//   - created_by はクライアント指定を受け付けず、staffBrainId(brain_staff.id)を使う
//   - clientRequestId冪等性がルート経由でも成立する
//
// extractStaffFromRequest / canAccessCustomer / verifyVisitBelongsToCustomer /
// createSupabaseCommitCustomerPhotoRepo の4箇所のみをモックし、route.ts本体・
// commitCustomerPhoto()本体は実コードをそのまま実行する(voice/commit.test.tsと同じ方針)。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'
import type {
  CommitCustomerPhotoRepo,
  CustomerPhotoRecord,
  InsertPhotoResult,
  UploadPhotoResult,
} from '../../src/lib/photos/commitCustomerPhoto'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({
  extractStaffFromRequest: vi.fn(),
}))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({
  canAccessCustomer: vi.fn(),
}))
vi.mock('../../src/lib/photos/ownership', () => ({
  verifyVisitBelongsToCustomer: vi.fn(),
}))
vi.mock('../../src/lib/photos/commitCustomerPhotoRepo.supabase', () => ({
  createSupabaseCommitCustomerPhotoRepo: vi.fn(),
}))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { verifyVisitBelongsToCustomer } from '../../src/lib/photos/ownership'
import { createSupabaseCommitCustomerPhotoRepo } from '../../src/lib/photos/commitCustomerPhotoRepo.supabase'
import { POST } from '../../app/api/customers/[id]/photos/route'

const mockExtractStaff  = vi.mocked(extractStaffFromRequest)
const mockCanAccess     = vi.mocked(canAccessCustomer)
const mockVerifyVisit   = vi.mocked(verifyVisitBelongsToCustomer)
const mockCreateRepo    = vi.mocked(createSupabaseCommitCustomerPhotoRepo)

const STAFF: RequestingStaff = {
  authUserId:   'auth-user-1',
  staffBrainId: 'brain-staff-1',
  email:        'staff@example.com',
  isAdmin:      false,
}

function createFakeRepo() {
  const photos: CustomerPhotoRecord[] = []
  let nextId = 1

  const repo: CommitCustomerPhotoRepo = {
    findPhotoByStoragePath: vi.fn(async (storagePath: string) =>
      photos.find(p => p.storagePath === storagePath) ?? null
    ),
    uploadPhoto: vi.fn(async (): Promise<UploadPhotoResult> => ({ ok: true })),
    insertPhoto: vi.fn(async (row): Promise<InsertPhotoResult> => {
      const rec: CustomerPhotoRecord = { id: `photo-${nextId++}`, storagePath: row.storagePath }
      photos.push(rec)
      return { ok: true, record: rec }
    }),
  }
  return { repo, photos }
}

function buildFormRequest(fields: {
  file?:            Blob | null
  visitId?:         string
  bodyPart?:        string | null
  photoType?:       string | null
  takenAt?:         string
  clientRequestId?: string | null
  customerId?:      string
}): NextRequest {
  const form = new FormData()
  if (fields.file !== null) {
    form.append('file', fields.file ?? new Blob(['dummy'], { type: 'image/webp' }), 'photo.webp')
  }
  if (fields.visitId !== undefined) form.append('visitId', fields.visitId)
  if (fields.bodyPart !== null) form.append('bodyPart', fields.bodyPart ?? 'cheek_left')
  if (fields.photoType !== null) form.append('photoType', fields.photoType ?? 'after')
  if (fields.takenAt !== undefined) form.append('takenAt', fields.takenAt)
  if (fields.clientRequestId !== null) form.append('clientRequestId', fields.clientRequestId ?? 'req-default')

  const customerId = fields.customerId ?? 'customer-a'
  const raw = new Request(`http://localhost/api/customers/${customerId}/photos`, {
    method: 'POST',
    body:   form,
  })
  return new NextRequest(raw)
}

function callRoute(fields: Parameters<typeof buildFormRequest>[0]) {
  const customerId = fields.customerId ?? 'customer-a'
  return POST(buildFormRequest(fields), { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/customers/[id]/photos', () => {
  it('未認証（extractStaffFromRequestがnull）は401を返し、認可チェック・repoに一切触れない', async () => {
    mockExtractStaff.mockResolvedValue(null)

    const res = await callRoute({ clientRequestId: 'req-1' })

    expect(res.status).toBe(401)
    expect(mockCanAccess).not.toHaveBeenCalled()
    expect(mockCreateRepo).not.toHaveBeenCalled()
  })

  it('アクセス権のない顧客への保存は403で拒否し、repoに一切触れない', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)

    const res  = await callRoute({ customerId: 'customer-forbidden', clientRequestId: 'req-2' })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(mockCanAccess).toHaveBeenCalledWith(STAFF.staffBrainId, 'customer-forbidden', STAFF.isAdmin)
    expect(mockCreateRepo).not.toHaveBeenCalled()
  })

  it('必須フィールド欠落（fileなし）は400で拒否し、認可チェック前に弾く', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)

    const res = await callRoute({ file: null, clientRequestId: 'req-3' })

    expect(res.status).toBe(400)
    expect(mockCanAccess).not.toHaveBeenCalled()
  })

  it('不正なphotoTypeは400を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)

    const res  = await callRoute({ photoType: 'invalid', clientRequestId: 'req-invalid-type' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_photo_type')
  })

  it('image/webp・image/jpeg以外のMIMEは415を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)

    const res  = await callRoute({
      file: new Blob(['dummy'], { type: 'image/png' }),
      clientRequestId: 'req-mime',
    })
    const body = await res.json()

    expect(res.status).toBe(415)
    expect(body.error).toBe('unsupported_media_type')
  })

  it('image/jpegは許可され200を返す(WebP非対応環境向けフォールバック)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const { repo } = createFakeRepo()
    mockCreateRepo.mockReturnValue(repo)

    const res  = await callRoute({
      file: new Blob(['dummy'], { type: 'image/jpeg' }),
      clientRequestId: 'req-jpeg-ok',
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('MIMEとstorage_pathの拡張子が一致する(webp→.webp、jpeg→.jpg)', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)

    const { repo: webpRepo } = createFakeRepo()
    mockCreateRepo.mockReturnValueOnce(webpRepo)
    const webpRes  = await callRoute({
      file: new Blob(['dummy'], { type: 'image/webp' }),
      clientRequestId: 'req-ext-webp',
    })
    const webpBody = await webpRes.json()
    expect(webpBody.storagePath).toMatch(/\.webp$/)

    const { repo: jpegRepo } = createFakeRepo()
    mockCreateRepo.mockReturnValueOnce(jpegRepo)
    const jpegRes  = await callRoute({
      file: new Blob(['dummy'], { type: 'image/jpeg' }),
      clientRequestId: 'req-ext-jpeg',
    })
    const jpegBody = await jpegRes.json()
    expect(jpegBody.storagePath).toMatch(/\.jpg$/)
  })

  it('サイズ超過は400 file_too_largeを返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)

    const oversized = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/webp' })
    const res  = await callRoute({ file: oversized, clientRequestId: 'req-size' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('file_too_large')
  })

  it('visitIdが対象customerに属さない場合は400 invalid_visit_idを返し、repoに触れない', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(false)

    const res  = await callRoute({ visitId: 'visit-other-customer', clientRequestId: 'req-visit' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_visit_id')
    expect(mockCreateRepo).not.toHaveBeenCalled()
  })

  it('created_byはクライアントから受け取らず、staffBrainId(brain_staff.id)のみを使う', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockVerifyVisit.mockResolvedValue(true)
    const { repo } = createFakeRepo()
    mockCreateRepo.mockReturnValue(repo)

    const res = await callRoute({ visitId: 'visit-1', clientRequestId: 'req-4' })
    expect(res.status).toBe(200)

    // commitCustomerPhoto経由でrepo.insertPhotoが呼ばれる際のcreatedByがstaffBrainIdであること
    expect(repo.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: STAFF.staffBrainId, customerId: 'customer-a' })
    )
    // authUserId(認証主体)がcreated_byとして使われていないことも明示的に確認
    expect(repo.insertPhoto).not.toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: STAFF.authUserId })
    )
  })

  it('storage_pathはクライアントから受け取らず、store_id/customer_id/clientRequestIdからサーバー側で決定される', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const { repo } = createFakeRepo()
    mockCreateRepo.mockReturnValue(repo)

    const res  = await callRoute({ clientRequestId: 'req-path' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.storagePath).toBe('00000000-0000-0000-0000-000000000001/customer-a/req-path.webp')
  })

  it('clientRequestId冪等性: ルート経由で同一IDを2回POSTしても1件のまま', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    const { repo, photos } = createFakeRepo()
    mockCreateRepo.mockReturnValue(repo)

    const res1  = await callRoute({ clientRequestId: 'req-idem-route' })
    const body1 = await res1.json()
    const res2  = await callRoute({ clientRequestId: 'req-idem-route' })
    const body2 = await res2.json()

    expect(body1.idempotent).toBe(false)
    expect(body2.idempotent).toBe(true)
    expect(body2.photoId).toBe(body1.photoId)
    expect(photos).toHaveLength(1)
    expect(repo.insertPhoto).toHaveBeenCalledTimes(1)
  })
})

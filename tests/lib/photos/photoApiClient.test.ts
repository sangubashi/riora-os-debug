// ================================================================
// photoApiClient.ts — 撮影画面から既存PHOTO_KARTE APIを呼ぶクライアントのテスト
//
// 対応: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 4節(order=ascの利用)、
//   docs/PHOTO_KARTE_API_DESIGN_1.md 5-1節(created_by等をクライアントから送らない)
// ================================================================
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/api/authedFetch', () => ({
  authedFetch: vi.fn(),
}))

import { authedFetch } from '../../../src/lib/api/authedFetch'
import {
  createPhotoListFetcher,
  listCustomerPhotos,
  uploadCustomerPhoto,
} from '../../../src/lib/photos/photoApiClient'

const mockFetch = vi.mocked(authedFetch)

afterEach(() => {
  vi.clearAllMocks()
})

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

describe('listCustomerPhotos / createPhotoListFetcher', () => {
  it('order=ascを指定した場合、そのままクエリに反映してGETする', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, photos: [] }))

    await listCustomerPhotos('customer-1', { bodyPart: 'face_front', order: 'asc', limit: 5 })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/customers/customer-1/photos?')
    expect(url).toContain('order=asc')
    expect(url).toContain('bodyPart=face_front')
    expect(url).toContain('limit=5')
  })

  it('order省略時はクエリにorderを含めない(既存APIの既定=descに委ねる)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, photos: [] }))
    await listCustomerPhotos('customer-1', { bodyPart: 'face_front' })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).not.toContain('order=')
  })

  it('visitId+photoTypeを渡すとクエリに反映する(Afterの同一visit検索用)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, photos: [] }))
    await listCustomerPhotos('customer-1', {
      bodyPart: 'face_front', visitId: 'visit-9', photoType: 'before', limit: 1,
    })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('visitId=visit-9')
    expect(url).toContain('photoType=before')
  })

  it('APIがsuccess:falseの場合は空配列を返す(呼び出し元でゴーストなし扱いになる)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: false, error: 'forbidden' }))
    const result = await listCustomerPhotos('customer-1', { bodyPart: 'face_front' })
    expect(result).toEqual([])
  })

  it('createPhotoListFetcherはcustomerIdを固定したPhotoListFetcherを返す', async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      success: true,
      photos: [{ id: 'p1', visitId: null, bodyPart: 'nose', photoType: 'progress', storagePath: 's', takenAt: 't' }],
    }))
    const fetcher = createPhotoListFetcher('customer-42')
    const result = await fetcher.listPhotos({ customerId: 'customer-42', bodyPart: 'nose' })
    expect(result).toHaveLength(1)
    expect((mockFetch.mock.calls[0][0] as string)).toContain('/customers/customer-42/photos')
  })
})

describe('uploadCustomerPhoto', () => {
  it('bodyPart/photoType/clientRequestId/fileをFormDataで送り、created_by等は送らない', async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      success: true, idempotent: false, photoId: 'photo-1', storagePath: 's/c/req-1.webp',
    }))

    const blob = new Blob(['x'], { type: 'image/webp' })
    await uploadCustomerPhoto('customer-1', {
      blob, bodyPart: 'face_front', photoType: 'before', visitId: 'visit-1', clientRequestId: 'req-1',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/customers/customer-1/photos')
    expect((init as RequestInit).method).toBe('POST')

    const form = (init as RequestInit).body as FormData
    expect(form.get('bodyPart')).toBe('face_front')
    expect(form.get('photoType')).toBe('before')
    expect(form.get('clientRequestId')).toBe('req-1')
    expect(form.get('visitId')).toBe('visit-1')
    expect(form.get('file')).toBeInstanceOf(Blob)

    // created_by / store_id / storage_path はクライアントから一切送らない
    // (PHOTO_KARTE_API_DESIGN_1.md 5-1節、サーバー側でJWT/固定値/決定的パスから解決する)
    expect(form.get('createdBy')).toBeNull()
    expect(form.get('created_by')).toBeNull()
    expect(form.get('storeId')).toBeNull()
    expect(form.get('store_id')).toBeNull()
    expect(form.get('storagePath')).toBeNull()
    expect(form.get('storage_path')).toBeNull()
  })

  it('blob.typeがimage/jpegの場合、FormDataのファイル名拡張子も.jpgになる(WebP/JPEGフォールバック対応)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, idempotent: false, photoId: 'p', storagePath: 's/c/req-jpg.jpg' }))
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    await uploadCustomerPhoto('customer-1', {
      blob, bodyPart: 'nose', photoType: 'before', visitId: null, clientRequestId: 'req-jpg',
    })
    const form = (mockFetch.mock.calls[0][1] as RequestInit).body as FormData
    const file = form.get('file') as File
    expect(file.name).toBe('req-jpg.jpg')
  })

  it('visitId=nullの場合、FormDataにvisitIdフィールドを含めない', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, idempotent: false, photoId: 'p', storagePath: 's' }))
    const blob = new Blob(['x'], { type: 'image/webp' })
    await uploadCustomerPhoto('customer-1', {
      blob, bodyPart: 'nose', photoType: 'progress', visitId: null, clientRequestId: 'req-2',
    })
    const form = (mockFetch.mock.calls[0][1] as RequestInit).body as FormData
    expect(form.get('visitId')).toBeNull()
  })

  it('APIがsuccess:falseを返した場合はエラーを投げる', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: false, reason: 'storage_upload_failed:x' }, false, 500))
    const blob = new Blob(['x'], { type: 'image/webp' })
    await expect(
      uploadCustomerPhoto('customer-1', {
        blob, bodyPart: 'nose', photoType: 'before', visitId: null, clientRequestId: 'req-3',
      })
    ).rejects.toThrow('storage_upload_failed:x')
  })
})

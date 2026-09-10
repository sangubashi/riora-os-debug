// ================================================================
// batchUpload.ts — 写真カルテ Phase A(原本保存)
//
// 最重要検証: 選択されたFile(iPad標準カメラのHEIC/JPEG原本相当)が、
// 縮小・再エンコード(convertImageFileToWebpBlob)を一切経由せず、
// そのままuploadCustomerPhoto()へ渡ることを確認する。
// ================================================================
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/photos/photoApiClient', () => ({
  uploadCustomerPhoto: vi.fn(),
}))
vi.mock('../../../src/lib/photos/fileToWebpBlob', () => ({
  convertImageFileToWebpBlob: vi.fn(),
}))

import { uploadCustomerPhoto } from '../../../src/lib/photos/photoApiClient'
import { convertImageFileToWebpBlob } from '../../../src/lib/photos/fileToWebpBlob'
import {
  buildBatchItems,
  summarizeUploadResults,
  uploadBatch,
  type BatchPhotoItem,
  type UploadBatchItemResult,
} from '../../../src/lib/photos/batchUpload'

const mockUpload  = vi.mocked(uploadCustomerPhoto)
const mockConvert = vi.mocked(convertImageFileToWebpBlob)

afterEach(() => {
  vi.clearAllMocks()
})

function fakeItem(overrides: Partial<BatchPhotoItem> = {}): BatchPhotoItem {
  const file = new File(['dummy-heic-bytes'], 'IMG_0001.HEIC', { type: 'image/heic' })
  return {
    id:            'item-1',
    file,
    previewUrl:    'blob:preview-1',
    bodyPart:      'face_front',
    isProvisional: true,
    status:        'idle',
    ...overrides,
  }
}

describe('uploadBatch（写真カルテ Phase A: 原本をそのままアップロードする）', () => {
  it('convertImageFileToWebpBlob()を一切呼ばない(縮小・再エンコードしない)', async () => {
    mockUpload.mockResolvedValue({ photoId: 'p1', storagePath: 's', idempotent: false })
    const item = fakeItem()

    await uploadBatch('customer-1', null, [item])

    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('選択された原本File自体(参照が同一)をblobとしてuploadCustomerPhotoへ渡す', async () => {
    mockUpload.mockResolvedValue({ photoId: 'p1', storagePath: 's', idempotent: false })
    const item = fakeItem()

    await uploadBatch('customer-1', 'visit-1', [item])

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [, payload] = mockUpload.mock.calls[0]
    expect(payload.blob).toBe(item.file) // 変換された別Blobではなく、まさにこのFile参照そのもの
    expect(payload.blob.type).toBe('image/heic')
    expect(payload.visitId).toBe('visit-1')
    expect(payload.bodyPart).toBe('face_front')
    expect(payload.photoType).toBe('progress')
  })

  it('HEIC/JPEGいずれのMIMEでも原本のtypeをそのまま維持して渡す', async () => {
    mockUpload.mockResolvedValue({ photoId: 'p1', storagePath: 's', idempotent: false })
    const jpegFile = new File(['dummy-jpeg-bytes'], 'IMG_0002.JPG', { type: 'image/jpeg' })
    const item = fakeItem({ id: 'item-2', file: jpegFile })

    await uploadBatch('customer-1', null, [item])

    const [, payload] = mockUpload.mock.calls[0]
    expect(payload.blob.type).toBe('image/jpeg')
  })

  it('1件が失敗しても他の写真の結果には影響しない(Promise.allSettled)', async () => {
    mockUpload
      .mockResolvedValueOnce({ photoId: 'p1', storagePath: 's1', idempotent: false })
      .mockRejectedValueOnce(new Error('upload_failed:500'))

    const results = await uploadBatch('customer-1', null, [
      fakeItem({ id: 'ok' }),
      fakeItem({ id: 'ng' }),
    ])

    expect(results).toEqual([
      { itemId: 'ok', ok: true },
      { itemId: 'ng', ok: false, error: 'upload_failed:500' },
    ])
  })
})

describe('summarizeUploadResults（「選択して追加」の無言失敗防止・toast文言決定）', () => {
  it('全件成功なら成功メッセージ・isError:falseを返す', () => {
    const results: UploadBatchItemResult[] = [
      { itemId: 'a', ok: true },
      { itemId: 'b', ok: true },
    ]
    expect(summarizeUploadResults(results)).toEqual({
      successCount: 2, failureCount: 0, message: '2枚登録しました', isError: false,
    })
  })

  it('全件失敗ならisError:trueで失敗件数を明示する', () => {
    const results: UploadBatchItemResult[] = [
      { itemId: 'a', ok: false, error: 'unsupported_media_type' },
      { itemId: 'b', ok: false, error: 'upload_failed:500' },
    ]
    const summary = summarizeUploadResults(results)
    expect(summary.isError).toBe(true)
    expect(summary.successCount).toBe(0)
    expect(summary.failureCount).toBe(2)
    expect(summary.message).toContain('2枚')
  })

  it('一部失敗でもisError:trueにする(成功分があっても見逃されないように)', () => {
    const results: UploadBatchItemResult[] = [
      { itemId: 'a', ok: true },
      { itemId: 'b', ok: false, error: 'upload_failed:500' },
    ]
    const summary = summarizeUploadResults(results)
    expect(summary.isError).toBe(true)
    expect(summary.successCount).toBe(1)
    expect(summary.failureCount).toBe(1)
  })
})

describe('buildBatchItems（無変更の既存動作を回帰確認）', () => {
  it('ちょうど3枚選択時は正面/左45°/右45°を順序で仮割当てする', () => {
    const files = [
      new File(['a'], 'a.heic', { type: 'image/heic' }),
      new File(['b'], 'b.heic', { type: 'image/heic' }),
      new File(['c'], 'c.heic', { type: 'image/heic' }),
    ]
    const items = buildBatchItems(files)
    expect(items.map(i => i.bodyPart)).toEqual(['face_front', 'face_left45', 'face_right45'])
    expect(items.every(i => i.isProvisional)).toBe(true)
  })
})

// ================================================================
// commitCustomerPhoto 検証
//
// docs/PHOTO_KARTE_API_DESIGN_1.md 2節・10節・11節に対応:
//   - brain_customer_photos への書込みが commitCustomerPhoto 経由でのみ発生する
//   - clientRequestId による冪等性(同一IDでの再呼び出しは重複書込みしない)
//   - Storageアップロード競合(衝突)時、DBに行があれば冪等応答
//   - Storageだけ存在する「真の孤児」の場合はupsert:trueで救済してから書込む
//   - DB INSERT時のUNIQUE(storage_path)違反(23505相当)も冪等応答に合流する
//   - このテストは in-memory fake のみを使い、実DB/ネットワークに一切触れない
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  buildPhotoStoragePath,
  commitCustomerPhoto,
  type CommitCustomerPhotoPayload,
  type CommitCustomerPhotoRepo,
  type CustomerPhotoRecord,
  type InsertPhotoResult,
  type UploadPhotoResult,
} from '../../../src/lib/photos/commitCustomerPhoto'

function createFakeRepo() {
  const photos: CustomerPhotoRecord[] = []
  const uploadedPaths = new Set<string>()

  let nextPhotoId = 1
  let uploadCallCount = 0
  let insertCallCount = 0

  const repo: CommitCustomerPhotoRepo = {
    async findPhotoByStoragePath(storagePath: string): Promise<CustomerPhotoRecord | null> {
      return photos.find(p => p.storagePath === storagePath) ?? null
    },

    async uploadPhoto(storagePath: string, _file: Blob, opts: { upsert: boolean }): Promise<UploadPhotoResult> {
      uploadCallCount++
      if (!opts.upsert && uploadedPaths.has(storagePath)) {
        return { ok: false, conflict: true, error: 'already exists' }
      }
      uploadedPaths.add(storagePath)
      return { ok: true }
    },

    async insertPhoto(row): Promise<InsertPhotoResult> {
      insertCallCount++
      if (photos.some(p => p.storagePath === row.storagePath)) {
        return { ok: false, conflict: true, error: 'duplicate key value violates unique constraint' }
      }
      const record: CustomerPhotoRecord = { id: `photo-${nextPhotoId++}`, storagePath: row.storagePath }
      photos.push(record)
      return { ok: true, record }
    },
  }

  return {
    repo,
    photos,
    getUploadCallCount: () => uploadCallCount,
    getInsertCallCount: () => insertCallCount,
  }
}

function makePayload(overrides: Partial<CommitCustomerPhotoPayload> = {}): CommitCustomerPhotoPayload {
  return {
    storeId:    'store-a',
    customerId: 'customer-a',
    visitId:    'visit-1',
    bodyPart:   'cheek_left',
    photoType:  'after',
    takenAt:    '2026-09-02T10:00:00.000Z',
    createdBy:  'staff-1',
    file:       new Blob(['dummy'], { type: 'image/webp' }),
    ...overrides,
  }
}

describe('commitCustomerPhoto', () => {
  it('通常コミットで brain_customer_photos に1件書き込む', async () => {
    const { repo, photos } = createFakeRepo()
    const result = await commitCustomerPhoto(repo, makePayload(), 'req-001')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.idempotent).toBe(false)
      expect(photos).toHaveLength(1)
      expect(result.photo.storagePath).toBe('store-a/customer-a/req-001.webp')
    }
  })

  it('同一 clientRequestId で2回呼んでも1件のまま(冪等性)', async () => {
    const { repo, photos, getInsertCallCount } = createFakeRepo()

    const r1 = await commitCustomerPhoto(repo, makePayload(), 'req-idem')
    const r2 = await commitCustomerPhoto(repo, makePayload(), 'req-idem')

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.idempotent).toBe(false)
      expect(r2.idempotent).toBe(true)
      expect(r2.photo.id).toBe(r1.photo.id)
    }
    expect(photos).toHaveLength(1)
    expect(getInsertCallCount()).toBe(1)
  })

  it('異なる clientRequestId なら別レコードとして保存される', async () => {
    const { repo, photos } = createFakeRepo()

    await commitCustomerPhoto(repo, makePayload(), 'req-a')
    await commitCustomerPhoto(repo, makePayload(), 'req-b')

    expect(photos).toHaveLength(2)
  })

  it('別customerであれば同一clientRequestIdでも衝突しない(storage_pathにcustomer_idが含まれるため)', async () => {
    const { repo, photos } = createFakeRepo()

    await commitCustomerPhoto(repo, makePayload({ customerId: 'customer-a' }), 'req-shared')
    await commitCustomerPhoto(repo, makePayload({ customerId: 'customer-b' }), 'req-shared')

    expect(photos).toHaveLength(2)
    expect(photos[0].storagePath).not.toBe(photos[1].storagePath)
  })

  it('Storageアップロードが衝突し、DBに既存行があれば冪等として扱い重複書込みしない', async () => {
    const { repo, photos } = createFakeRepo()

    const payload = makePayload()
    const storagePath = buildPhotoStoragePath(payload.storeId, payload.customerId, 'req-race', 'webp')
    await repo.uploadPhoto(storagePath, payload.file, { upsert: false })
    const existing = await repo.insertPhoto({
      storeId: payload.storeId, customerId: payload.customerId, visitId: payload.visitId,
      bodyPart: payload.bodyPart, photoType: payload.photoType, storagePath,
      takenAt: payload.takenAt, createdBy: payload.createdBy,
    })
    if (!existing.ok) throw new Error('setup failed')

    const result = await commitCustomerPhoto(repo, payload, 'req-race')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.idempotent).toBe(true)
      expect(result.photo.id).toBe(existing.record.id)
    }
    expect(photos).toHaveLength(1)
  })

  it('真の孤児(Storageのみ存在・DB行なし)はupsert:trueで救済してから書き込む', async () => {
    const { repo, photos, getUploadCallCount } = createFakeRepo()

    const payload = makePayload()
    const storagePath = buildPhotoStoragePath(payload.storeId, payload.customerId, 'req-orphan', 'webp')
    // Storageにだけ先に存在させる(過去のDB INSERT失敗を模擬。DB行は作らない)
    await repo.uploadPhoto(storagePath, payload.file, { upsert: false })

    const result = await commitCustomerPhoto(repo, payload, 'req-orphan')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.idempotent).toBe(false)
    }
    expect(photos).toHaveLength(1)
    // セットアップでの1回 + commitCustomerPhoto内の衝突検知1回 + upsert:trueでの救済1回 = 合計3回
    expect(getUploadCallCount()).toBe(3)
  })

  it('DB INSERT時にUNIQUE制約違反(23505相当)が起きた場合は冪等応答に合流する', async () => {
    const photos: CustomerPhotoRecord[] = []
    let insertAttempts = 0

    const repo: CommitCustomerPhotoRepo = {
      async findPhotoByStoragePath(storagePath) {
        // 1回目の検索は空振り(真の同時実行競合を模擬)、2回目以降は見つかる
        if (insertAttempts === 0) return null
        return photos.find(p => p.storagePath === storagePath) ?? null
      },
      async uploadPhoto() {
        return { ok: true }
      },
      async insertPhoto(row) {
        insertAttempts++
        // 常に競合(他リクエストが先にINSERTしたことをシミュレート)
        if (photos.length === 0) {
          photos.push({ id: 'photo-winner', storagePath: row.storagePath })
        }
        return { ok: false, conflict: true, error: 'duplicate key value violates unique constraint "ux_brain_customer_photos_storage_path"' }
      },
    }

    const result = await commitCustomerPhoto(repo, makePayload(), 'req-db-race')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.idempotent).toBe(true)
      expect(result.photo.id).toBe('photo-winner')
    }
  })

  it('Storageアップロードが衝突なしで失敗した場合は ok:false を返し、DBには何も書き込まない', async () => {
    const photos: CustomerPhotoRecord[] = []
    let insertCalled = false
    const repo: CommitCustomerPhotoRepo = {
      async findPhotoByStoragePath() { return null },
      async uploadPhoto(): Promise<UploadPhotoResult> {
        return { ok: false, conflict: false, error: 'network down' }
      },
      async insertPhoto(row) {
        insertCalled = true
        const rec = { id: 'photo-x', storagePath: row.storagePath }
        photos.push(rec)
        return { ok: true, record: rec }
      },
    }

    const result = await commitCustomerPhoto(repo, makePayload(), 'req-fail')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/^storage_upload_failed/)
    expect(insertCalled).toBe(false)
    expect(photos).toHaveLength(0)
  })

  it('buildPhotoStoragePath は storeId・customerId・clientRequestId・extension から決定的に導出される', () => {
    const p1 = buildPhotoStoragePath('store-a', 'customer-a', 'req-001', 'webp')
    const p2 = buildPhotoStoragePath('store-a', 'customer-a', 'req-001', 'webp')
    const p3 = buildPhotoStoragePath('store-a', 'customer-a', 'req-002', 'webp')
    const p4 = buildPhotoStoragePath('store-a', 'customer-a', 'req-001', 'jpg')

    expect(p1).toBe(p2)
    expect(p1).not.toBe(p3)
    expect(p1).not.toBe(p4)
    expect(p1).toBe('store-a/customer-a/req-001.webp')
    expect(p4).toBe('store-a/customer-a/req-001.jpg')
  })

  it('payload.file.typeがimage/jpegの場合、storage_pathの拡張子が.jpgになる', async () => {
    const { repo, photos } = createFakeRepo()
    const payload = makePayload({ file: new Blob(['dummy'], { type: 'image/jpeg' }) })

    const result = await commitCustomerPhoto(repo, payload, 'req-jpeg')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.photo.storagePath).toBe('store-a/customer-a/req-jpeg.jpg')
    }
    expect(photos).toHaveLength(1)
  })

  it('未知のfile.typeの場合はwebp拡張子にフォールバックする(型安全のための防御、通常は発生しない)', async () => {
    const { repo } = createFakeRepo()
    const payload = makePayload({ file: new Blob(['dummy'], { type: 'application/octet-stream' }) })

    const result = await commitCustomerPhoto(repo, payload, 'req-unknown-type')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.photo.storagePath).toBe('store-a/customer-a/req-unknown-type.webp')
    }
  })
})

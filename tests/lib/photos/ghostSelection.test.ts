// ================================================================
// ghostSelection.ts — ゴースト優先順位ロジックの単体テスト
//
// 対応: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 4節、実装前レビューで確定した
//   After優先順位(同一visitのBefore→前回→初回→なし)。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  selectGhostForAfter,
  selectGhostForBefore,
  type GhostCandidatePhoto,
  type ListPhotosParams,
  type PhotoListFetcher,
} from '../../../src/lib/photos/ghostSelection'

function photo(overrides: Partial<GhostCandidatePhoto> = {}): GhostCandidatePhoto {
  return {
    id: 'photo-1', visitId: 'visit-1', bodyPart: 'face_front', photoType: 'before',
    storagePath: 's/c/photo-1.webp', takenAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

/** listPhotos呼び出しを記録しつつ、指定した振る舞いを返すフェイク */
function fakeFetcher(
  impl: (params: ListPhotosParams) => GhostCandidatePhoto[]
): { fetcher: PhotoListFetcher; calls: ListPhotosParams[] } {
  const calls: ListPhotosParams[] = []
  return {
    calls,
    fetcher: {
      listPhotos: async (params) => {
        calls.push(params)
        return impl(params)
      },
    },
  }
}

describe('selectGhostForBefore', () => {
  it('前回(order=desc)の写真があればそれを basis: previous として返す', async () => {
    const { fetcher, calls } = fakeFetcher((p) =>
      p.order === 'desc' ? [photo({ id: 'prev-1', visitId: 'visit-0' })] : []
    )
    const result = await selectGhostForBefore(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toEqual({ photo: expect.objectContaining({ id: 'prev-1' }), basis: 'previous' })
    // order=ascは呼ばれない(前回が見つかった時点で初回を探す必要がない)
    expect(calls.some(c => c.order === 'asc')).toBe(false)
  })

  it('前回が無い場合、order=ascで初回を取得しbasis: firstとして返す', async () => {
    const { fetcher, calls } = fakeFetcher((p) =>
      p.order === 'asc' ? [photo({ id: 'first-1', visitId: 'visit-old', takenAt: '2026-01-01T00:00:00Z' })] : []
    )
    const result = await selectGhostForBefore(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toEqual({ photo: expect.objectContaining({ id: 'first-1' }), basis: 'first' })
    // 初回取得にorder=ascが実際に使われたことを確認(R2追補の利用)
    expect(calls.some(c => c.order === 'asc' && c.bodyPart === 'face_front')).toBe(true)
  })

  it('前回・初回いずれも無ければnullを返す(ゴーストなし)', async () => {
    const { fetcher } = fakeFetcher(() => [])
    const result = await selectGhostForBefore(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toBeNull()
  })

  it('同一visit(現在撮影中)の写真は前回・初回の候補から除外する', async () => {
    const { fetcher } = fakeFetcher((p) => {
      const own = photo({ id: 'own', visitId: 'visit-1', takenAt: '2026-09-02T00:00:00Z' })
      const other = photo({ id: 'other-visit', visitId: 'visit-0', takenAt: '2026-08-01T00:00:00Z' })
      return p.order === 'desc' ? [own, other] : []
    })
    const result = await selectGhostForBefore(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result?.photo.id).toBe('other-visit')
  })
})

describe('selectGhostForAfter', () => {
  it('同一visit+同一body_partのBeforeがあれば最優先でbasis: same_visit_beforeを返す', async () => {
    const { fetcher, calls } = fakeFetcher((p) =>
      p.visitId === 'visit-1' && p.photoType === 'before'
        ? [photo({ id: 'today-before', visitId: 'visit-1', photoType: 'before' })]
        : [photo({ id: 'should-not-be-used', visitId: 'visit-0' })]
    )
    const result = await selectGhostForAfter(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toEqual({ photo: expect.objectContaining({ id: 'today-before' }), basis: 'same_visit_before' })
    // 同一visitのBeforeが見つかった場合、前回visitのdesc/asc検索は行わない
    expect(calls.every(c => !(c.order === 'desc' && !c.visitId))).toBe(true)
  })

  it('同一visitのBeforeが無ければ前回visitの写真にフォールバックする(basis: previous)', async () => {
    const { fetcher } = fakeFetcher((p) => {
      if (p.visitId === 'visit-1' && p.photoType === 'before') return []
      if (p.order === 'desc') return [photo({ id: 'prev-visit', visitId: 'visit-0' })]
      return []
    })
    const result = await selectGhostForAfter(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toEqual({ photo: expect.objectContaining({ id: 'prev-visit' }), basis: 'previous' })
  })

  it('同一visitのBeforeも前回visitの写真も無ければ初回にフォールバックする(basis: first)', async () => {
    const { fetcher } = fakeFetcher((p) => {
      if (p.visitId === 'visit-1' && p.photoType === 'before') return []
      if (p.order === 'desc') return []
      if (p.order === 'asc') return [photo({ id: 'first-1', visitId: 'visit-old' })]
      return []
    })
    const result = await selectGhostForAfter(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toEqual({ photo: expect.objectContaining({ id: 'first-1' }), basis: 'first' })
  })

  it('何も無ければnullを返す', async () => {
    const { fetcher } = fakeFetcher(() => [])
    const result = await selectGhostForAfter(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result).toBeNull()
  })

  it('currentVisitId=null(単発撮影)の場合は同一visit検索をスキップしBeforeロジックへ進む', async () => {
    const { fetcher, calls } = fakeFetcher((p) =>
      p.order === 'desc' ? [photo({ id: 'prev-1' })] : []
    )
    const result = await selectGhostForAfter(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: null,
    })
    expect(result?.basis).toBe('previous')
    expect(calls.some(c => c.photoType === 'before')).toBe(false)
  })
})

describe('防御的重複排除(3-5節)', () => {
  it('同一visit_id+photo_typeの重複行が残っていても最新1件だけを候補として使う', async () => {
    const { fetcher } = fakeFetcher((p) => {
      if (p.order !== 'desc') return []
      return [
        photo({ id: 'dup-newer', visitId: 'visit-0', photoType: 'after', takenAt: '2026-09-02T00:00:00Z' }),
        photo({ id: 'dup-older', visitId: 'visit-0', photoType: 'after', takenAt: '2026-09-01T00:00:00Z' }),
      ]
    })
    const result = await selectGhostForBefore(fetcher, {
      customerId: 'c1', bodyPart: 'face_front', currentVisitId: 'visit-1',
    })
    expect(result?.photo.id).toBe('dup-newer')
  })
})

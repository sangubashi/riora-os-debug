// ================================================================
// comparisonSelection.ts — Before/After左右比較の組み立てロジックのテスト
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  buildFirstComparison,
  buildPreviousComparison,
  comparableGroups,
  groupPhotosByBodyPart,
} from '../../../src/lib/photos/comparisonSelection'
import type { TimelinePhoto } from '../../../src/lib/photos/photoApiClient'

function photo(overrides: Partial<TimelinePhoto>): TimelinePhoto {
  return {
    id: 'p', visitId: null, visitDate: null, menuName: null,
    bodyPart: 'nose', photoType: 'progress', storagePath: 's', takenAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('groupPhotosByBodyPart', () => {
  it('body_partごとにグルーピングし、入力順(desc想定)を維持する', () => {
    const photos = [
      photo({ id: 'a', bodyPart: 'nose', takenAt: '2026-09-05T00:00:00Z' }),
      photo({ id: 'b', bodyPart: 'face_front', takenAt: '2026-09-04T00:00:00Z' }),
      photo({ id: 'c', bodyPart: 'nose', takenAt: '2026-09-01T00:00:00Z' }),
    ]
    const groups = groupPhotosByBodyPart(photos)
    expect(groups).toHaveLength(2)
    const noseGroup = groups.find(g => g.bodyPart === 'nose')!
    expect(noseGroup.photos.map(p => p.id)).toEqual(['a', 'c'])
  })

  it('空配列を渡すと空配列を返す', () => {
    expect(groupPhotosByBodyPart([])).toEqual([])
  })
})

describe('comparableGroups', () => {
  it('2枚未満のグループを除外する', () => {
    const groups = groupPhotosByBodyPart([
      photo({ id: 'a', bodyPart: 'nose' }),
      photo({ id: 'b', bodyPart: 'nose' }),
      photo({ id: 'c', bodyPart: 'chin' }),
    ])
    const result = comparableGroups(groups)
    expect(result).toHaveLength(1)
    expect(result[0].bodyPart).toBe('nose')
  })
})

describe('buildPreviousComparison', () => {
  it('先頭(最新)をcurrent、2番目をreferenceにしてbasis=previousを返す', () => {
    const group = {
      bodyPart: 'nose',
      photos: [
        photo({ id: 'newest', takenAt: '2026-09-05T00:00:00Z' }),
        photo({ id: 'middle', takenAt: '2026-09-03T00:00:00Z' }),
        photo({ id: 'oldest', takenAt: '2026-09-01T00:00:00Z' }),
      ],
    }
    const pair = buildPreviousComparison(group)
    expect(pair).toEqual({
      bodyPart: 'nose', current: group.photos[0], reference: group.photos[1], basis: 'previous',
    })
  })
})

describe('buildFirstComparison', () => {
  it('先頭(最新)をcurrent、末尾(最古)をreferenceにしてbasis=firstを返す', () => {
    const group = {
      bodyPart: 'nose',
      photos: [
        photo({ id: 'newest', takenAt: '2026-09-05T00:00:00Z' }),
        photo({ id: 'middle', takenAt: '2026-09-03T00:00:00Z' }),
        photo({ id: 'oldest', takenAt: '2026-09-01T00:00:00Z' }),
      ],
    }
    const pair = buildFirstComparison(group)
    expect(pair).toEqual({
      bodyPart: 'nose', current: group.photos[0], reference: group.photos[2], basis: 'first',
    })
  })

  it('ちょうど2枚の場合、current/referenceはbuildPreviousComparisonと同じになる(basisのみ異なる)', () => {
    const group = {
      bodyPart: 'nose',
      photos: [
        photo({ id: 'newest', takenAt: '2026-09-05T00:00:00Z' }),
        photo({ id: 'oldest', takenAt: '2026-09-01T00:00:00Z' }),
      ],
    }
    const first = buildFirstComparison(group)
    const previous = buildPreviousComparison(group)
    expect(first.current).toEqual(previous.current)
    expect(first.reference).toEqual(previous.reference)
    expect(first.basis).toBe('first')
    expect(previous.basis).toBe('previous')
  })
})

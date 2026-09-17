// ================================================================
// comparePairSelection.ts — Before/After比較UI(スライダー画面)の
// 初期ペア選定・日付候補一覧ロジックのテスト
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  pickInitialComparisonPair,
  listComparableBodyParts,
  listOccasionOptions,
  formatOccasionDateLabel,
} from '../../../src/lib/photos/comparePairSelection'
import type { TimelinePhoto } from '../../../src/lib/photos/photoApiClient'

function photo(overrides: Partial<TimelinePhoto>): TimelinePhoto {
  return {
    id: 'p', visitId: null, visitDate: null, visitCountAt: null, menuName: null,
    bodyPart: 'face_front', photoType: 'progress', storagePath: 's', takenAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('pickInitialComparisonPair', () => {
  it('比較可能な部位が無ければnullを返す', () => {
    const photos = [photo({ id: 'a', bodyPart: 'face_front', takenAt: '2026-09-01T00:00:00Z' })]
    expect(pickInitialComparisonPair(photos)).toBeNull()
  })

  it('preferredBodyPartが比較可能ならその部位を優先する(同じアングル同士を優先)', () => {
    const photos = [
      photo({ id: 'front-new', bodyPart: 'face_front', takenAt: '2026-09-10T00:00:00Z' }),
      photo({ id: 'front-old', bodyPart: 'face_front', takenAt: '2026-09-01T00:00:00Z' }),
      // forehead の方が新しいが、preferredBodyPart指定時はそちらを無視する
      photo({ id: 'forehead-new', bodyPart: 'forehead', takenAt: '2026-09-15T00:00:00Z' }),
      photo({ id: 'forehead-old', bodyPart: 'forehead', takenAt: '2026-09-02T00:00:00Z' }),
    ]
    const pair = pickInitialComparisonPair(photos, 'face_front')
    expect(pair?.bodyPart).toBe('face_front')
    expect(pair?.current.id).toBe('front-new')
    expect(pair?.reference.id).toBe('front-old')
  })

  it('preferredBodyPartが比較不可(撮影機会1つ)の場合は他の比較可能な部位へフォールバックする', () => {
    const photos = [
      photo({ id: 'front-only', bodyPart: 'face_front', takenAt: '2026-09-10T00:00:00Z' }),
      photo({ id: 'forehead-new', bodyPart: 'forehead', takenAt: '2026-09-15T00:00:00Z' }),
      photo({ id: 'forehead-old', bodyPart: 'forehead', takenAt: '2026-09-02T00:00:00Z' }),
    ]
    const pair = pickInitialComparisonPair(photos, 'face_front')
    expect(pair?.bodyPart).toBe('forehead')
  })

  it('preferredBodyPart未指定時は最新の撮影機会が最も新しい部位を選ぶ', () => {
    const photos = [
      photo({ id: 'front-new', bodyPart: 'face_front', takenAt: '2026-09-05T00:00:00Z' }),
      photo({ id: 'front-old', bodyPart: 'face_front', takenAt: '2026-09-01T00:00:00Z' }),
      photo({ id: 'right-new', bodyPart: 'face_right', takenAt: '2026-09-10T00:00:00Z' }),
      photo({ id: 'right-old', bodyPart: 'face_right', takenAt: '2026-09-02T00:00:00Z' }),
    ]
    const pair = pickInitialComparisonPair(photos)
    expect(pair?.bodyPart).toBe('face_right')
  })
})

describe('listComparableBodyParts', () => {
  it('撮影機会が2つ以上ある部位のみ返す', () => {
    const photos = [
      photo({ id: 'a', bodyPart: 'face_front', takenAt: '2026-09-01T00:00:00Z' }),
      photo({ id: 'b', bodyPart: 'face_front', takenAt: '2026-09-05T00:00:00Z' }),
      photo({ id: 'c', bodyPart: 'forehead', takenAt: '2026-09-01T00:00:00Z' }),
    ]
    expect(listComparableBodyParts(photos)).toEqual(['face_front'])
  })
})

describe('listOccasionOptions', () => {
  it('指定部位の撮影機会を新しい順で返す(入力は既存APIと同じtaken_at DESC順を前提とする)', () => {
    const photos = [
      photo({ id: 'b', bodyPart: 'face_front', takenAt: '2026-09-10T00:00:00Z' }),
      photo({ id: 'c', bodyPart: 'forehead', takenAt: '2026-09-05T00:00:00Z' }),
      photo({ id: 'a', bodyPart: 'face_front', takenAt: '2026-09-01T00:00:00Z' }),
    ]
    const options = listOccasionOptions(photos, 'face_front')
    expect(options.map(o => o.photo.id)).toEqual(['b', 'a'])
  })

  it('該当部位が無ければ空配列', () => {
    expect(listOccasionOptions([], 'face_front')).toEqual([])
  })
})

describe('formatOccasionDateLabel', () => {
  it('本日を「本日」と表示する', () => {
    const { relative } = formatOccasionDateLabel(new Date().toISOString())
    expect(relative).toBe('本日')
  })

  it('日付をYYYY/MM/DD形式に整形する', () => {
    const { dateStr } = formatOccasionDateLabel('2026-03-15T00:00:00Z')
    expect(dateStr).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
  })
})

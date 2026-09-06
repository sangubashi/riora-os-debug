// ================================================================
// timelineGrouping.ts — Photo Timelineの日付グルーピングのテスト
// ================================================================
import { describe, expect, it } from 'vitest'
import { formatDateLabel, groupPhotosByDate } from '../../../src/lib/photos/timelineGrouping'
import type { TimelinePhoto } from '../../../src/lib/photos/photoApiClient'

function photo(overrides: Partial<TimelinePhoto>): TimelinePhoto {
  return {
    id: 'p', visitId: null, visitDate: null, menuName: null,
    bodyPart: 'nose', photoType: 'progress', storagePath: 's', takenAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('groupPhotosByDate', () => {
  it('同一日付(taken_atのUTC日付部分)の写真を1グループにまとめる', () => {
    const photos = [
      photo({ id: 'a', takenAt: '2026-09-03T01:00:00Z' }),
      photo({ id: 'b', takenAt: '2026-09-03T05:00:00Z' }),
      photo({ id: 'c', takenAt: '2026-09-01T00:00:00Z' }),
    ]
    const groups = groupPhotosByDate(photos)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ dateKey: '2026-09-03' })
    expect(groups[0].photos.map(p => p.id)).toEqual(['a', 'b'])
    expect(groups[1]).toMatchObject({ dateKey: '2026-09-01' })
  })

  it('入力順(taken_at DESC想定)を保ったままグループの並び順にする', () => {
    const photos = [
      photo({ id: 'newest', takenAt: '2026-09-05T00:00:00Z' }),
      photo({ id: 'middle', takenAt: '2026-09-03T00:00:00Z' }),
      photo({ id: 'oldest', takenAt: '2026-09-01T00:00:00Z' }),
    ]
    const groups = groupPhotosByDate(photos)
    expect(groups.map(g => g.dateKey)).toEqual(['2026-09-05', '2026-09-03', '2026-09-01'])
  })

  it('空配列を渡すと空配列を返す', () => {
    expect(groupPhotosByDate([])).toEqual([])
  })
})

describe('formatDateLabel', () => {
  it('YYYY-MM-DDを日本語の日付表記に変換する', () => {
    expect(formatDateLabel('2026-09-03')).toBe('2026年9月3日')
  })

  it('月・日の先頭ゼロを除去する', () => {
    expect(formatDateLabel('2026-01-05')).toBe('2026年1月5日')
  })

  it('不正な形式はそのまま返す', () => {
    expect(formatDateLabel('not-a-date')).toBe('not-a-date')
  })
})

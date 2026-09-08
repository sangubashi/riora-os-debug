// ================================================================
// timelineGrouping.ts — Photo Timelineの日付グルーピングのテスト
// ================================================================
import { describe, expect, it } from 'vitest'
import { buildVisitTabs, formatDateLabel, groupPhotosByDate } from '../../../src/lib/photos/timelineGrouping'
import type { TimelinePhoto } from '../../../src/lib/photos/photoApiClient'

function photo(overrides: Partial<TimelinePhoto>): TimelinePhoto {
  return {
    id: 'p', visitId: null, visitDate: null, visitCountAt: null, menuName: null,
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

describe('buildVisitTabs（写真カルテ Phase2: 来店回数タブ）', () => {
  it('ケース1: visit_id/visitCountAtが両方揃っている写真は来店タブになる', () => {
    const photos = [photo({ id: 'a', visitId: 'v1', visitCountAt: 3 })]
    const tabs = buildVisitTabs(photos)
    expect(tabs).toEqual([{ visitId: 'v1', visitCountAt: 3, visitDate: null }])
  })

  it('ケース2: 同じvisitに複数写真があっても来店タブは1つだけになる', () => {
    const photos = [
      photo({ id: 'a', visitId: 'v1', visitCountAt: 3, bodyPart: 'face_front' }),
      photo({ id: 'b', visitId: 'v1', visitCountAt: 3, bodyPart: 'face_left45' }),
      photo({ id: 'c', visitId: 'v1', visitCountAt: 3, bodyPart: 'face_right45' }),
    ]
    const tabs = buildVisitTabs(photos)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toEqual({ visitId: 'v1', visitCountAt: 3, visitDate: null })
  })

  it('ケース3: visitCountAtが1,2,4の場合、[1,2,4]をそのまま返し3を勝手に作らない(欠番を埋めない)', () => {
    const photos = [
      photo({ id: 'a', visitId: 'v1', visitCountAt: 1 }),
      photo({ id: 'b', visitId: 'v2', visitCountAt: 2 }),
      photo({ id: 'c', visitId: 'v4', visitCountAt: 4 }),
    ]
    const tabs = buildVisitTabs(photos)
    expect(tabs.map(t => t.visitCountAt)).toEqual([1, 2, 4])
  })

  it('ケース4: visit_id===nullの写真は来店タブに含めない', () => {
    const photos = [
      photo({ id: 'a', visitId: null, visitCountAt: null }),
      photo({ id: 'b', visitId: 'v1', visitCountAt: 1 }),
    ]
    const tabs = buildVisitTabs(photos)
    expect(tabs).toEqual([{ visitId: 'v1', visitCountAt: 1, visitDate: null }])
  })

  it('visitCountAtがnull(visit_idはあるが未解決)の写真も来店タブに含めない', () => {
    const photos = [photo({ id: 'a', visitId: 'v1', visitCountAt: null })]
    expect(buildVisitTabs(photos)).toEqual([])
  })

  it('visitCountAt昇順(初回が先頭)で返す(入力順が降順でも並べ替える)', () => {
    const photos = [
      photo({ id: 'a', visitId: 'v3', visitCountAt: 3 }),
      photo({ id: 'b', visitId: 'v1', visitCountAt: 1 }),
      photo({ id: 'c', visitId: 'v2', visitCountAt: 2 }),
    ]
    const tabs = buildVisitTabs(photos)
    expect(tabs.map(t => t.visitCountAt)).toEqual([1, 2, 3])
  })

  it('visitDateも来店タブに保持する', () => {
    const photos = [photo({ id: 'a', visitId: 'v1', visitCountAt: 1, visitDate: '2026-09-01' })]
    expect(buildVisitTabs(photos)[0].visitDate).toBe('2026-09-01')
  })

  it('ケース6: 来店回数が多い場合(100件)でも全件を欠落なく昇順で返す', () => {
    const photos = Array.from({ length: 100 }, (_, i) => {
      const visitCountAt = 100 - i // 降順で投入(taken_at DESC想定)
      return photo({ id: `p${i}`, visitId: `v${visitCountAt}`, visitCountAt })
    })
    const tabs = buildVisitTabs(photos)
    expect(tabs).toHaveLength(100)
    expect(tabs.map(t => t.visitCountAt)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
  })

  it('空配列を渡すと空配列を返す', () => {
    expect(buildVisitTabs([])).toEqual([])
  })
})

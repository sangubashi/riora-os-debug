import { describe, it, expect } from 'vitest'
import {
  angleOfBodyPart, bodyPartOfAngle, isPhotoAngle, listPhotoDays, listPhotosOfDay, photoDayKey, formatDayTab,
} from '@/lib/photos/photoAngle'
import type { TimelinePhoto } from '@/lib/photos/photoApiClient'

const ph = (id: string, bodyPart: string, takenAt: string): TimelinePhoto => ({
  id, visitId: null, visitDate: null, visitCountAt: null, menuName: null,
  bodyPart, photoType: 'progress', storagePath: id, takenAt,
})

describe('photoAngle', () => {
  it('body_partをアングルへ正規化し、レガシー値はotherに寄せる', () => {
    expect(angleOfBodyPart('face_front')).toBe('front')
    expect(angleOfBodyPart('face_right')).toBe('right')
    expect(angleOfBodyPart('face_left')).toBe('left')
    expect(angleOfBodyPart('forehead')).toBe('forehead')
    expect(angleOfBodyPart('face_right45')).toBe('other')
    expect(angleOfBodyPart('cheek_left')).toBe('other')
  })
  it('angle→body_partが往復する', () => {
    for (const a of ['front', 'right', 'left', 'forehead'] as const) {
      expect(angleOfBodyPart(bodyPartOfAngle(a))).toBe(a)
    }
    expect(isPhotoAngle('front')).toBe(true)
    expect(isPhotoAngle('face_front')).toBe(false)
  })
  it('撮影日はJST暦日で判定する(UTC 15:30 = JST翌日00:30)', () => {
    expect(photoDayKey({ takenAt: '2026-09-12T15:30:00Z' })).toBe('2026-09-13')
  })
  it('日付一覧は新しい順・件数付き、その日の写真はアングル順', () => {
    const photos = [
      ph('a', 'forehead',   '2026-09-13T01:00:00Z'),
      ph('b', 'face_front', '2026-09-13T02:00:00Z'),
      ph('c', 'face_front', '2026-09-13T03:00:00Z'),
      ph('d', 'face_left',  '2026-08-01T03:00:00Z'),
    ]
    expect(listPhotoDays(photos)).toEqual([
      { dayKey: '2026-09-13', count: 3 }, { dayKey: '2026-08-01', count: 1 },
    ])
    expect(listPhotosOfDay(photos, '2026-09-13').map(p => p.id)).toEqual(['c', 'b', 'a'])
    expect(formatDayTab('2026-09-03')).toBe('9/3')
  })
})

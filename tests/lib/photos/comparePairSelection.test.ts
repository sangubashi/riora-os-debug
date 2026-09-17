// ================================================================
// comparePairSelection.ts — Before/After比較UI(スライダー画面)の
// 個別写真単位の比較候補選択・日付候補一覧ロジックのテスト
//
// 2026-09-17改訂: occasion(撮影機会)単位からphoto(個別写真)単位へのロジック変更に伴う
// テスト全面書き換え。ケースA(同日複数枚が比較可能になること)を中心に検証する。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  pickInitialComparisonPair,
  listComparableBodyParts,
  listPhotoOptions,
  formatPhotoDateLabel,
  buildPhotoOptionLabels,
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
  it('比較可能な部位(2枚以上)が無ければnullを返す', () => {
    const photos = [photo({ id: 'a', bodyPart: 'face_front', takenAt: '2026-09-01T00:00:00Z' })]
    expect(pickInitialComparisonPair(photos)).toBeNull()
  })

  it('【ケースA】同一日・同一部位の3枚は比較可能になり、最新2枚が選ばれる(occasion丸め込みの撤廃)', () => {
    const photos = [
      photo({ id: 'front-3', bodyPart: 'face_front', takenAt: '2026-09-17T01:08:00Z' }),
      photo({ id: 'front-2', bodyPart: 'face_front', takenAt: '2026-09-17T01:05:00Z' }),
      photo({ id: 'front-1', bodyPart: 'face_front', takenAt: '2026-09-17T01:02:00Z' }),
    ]
    const pair = pickInitialComparisonPair(photos, 'face_front')
    expect(pair).not.toBeNull()
    expect(pair?.current.id).toBe('front-3')
    expect(pair?.reference.id).toBe('front-2')
  })

  it('【ケースB】異なる日付の2枚(同一部位)は比較可能', () => {
    const photos = [
      photo({ id: 'new', bodyPart: 'face_front', takenAt: '2026-09-20T00:00:00Z' }),
      photo({ id: 'old', bodyPart: 'face_front', takenAt: '2026-09-17T00:00:00Z' }),
    ]
    const pair = pickInitialComparisonPair(photos, 'face_front')
    expect(pair?.current.id).toBe('new')
    expect(pair?.reference.id).toBe('old')
  })

  it('【ケースC】同一日でも部位が異なれば比較対象にならない(部位ごとに1枚ずつのため)', () => {
    const photos = [
      photo({ id: 'front', bodyPart: 'face_front', takenAt: '2026-09-17T00:00:00Z' }),
      photo({ id: 'left45', bodyPart: 'face_left45', takenAt: '2026-09-17T00:00:00Z' }),
    ]
    expect(pickInitialComparisonPair(photos, 'face_front')).toBeNull()
    expect(pickInitialComparisonPair(photos, 'face_left45')).toBeNull()
    expect(pickInitialComparisonPair(photos)).toBeNull()
  })

  it('preferredBodyPartが比較可能(2枚以上)ならその部位を優先する(同じアングル同士を優先)', () => {
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

  it('preferredBodyPartが写真1枚以下(比較不可)の場合は他の比較可能な部位へフォールバックする', () => {
    const photos = [
      photo({ id: 'front-only', bodyPart: 'face_front', takenAt: '2026-09-10T00:00:00Z' }),
      photo({ id: 'forehead-new', bodyPart: 'forehead', takenAt: '2026-09-15T00:00:00Z' }),
      photo({ id: 'forehead-old', bodyPart: 'forehead', takenAt: '2026-09-02T00:00:00Z' }),
    ]
    const pair = pickInitialComparisonPair(photos, 'face_front')
    expect(pair?.bodyPart).toBe('forehead')
  })

  it('preferredBodyPart未指定時は最新の撮影が最も新しい部位を選ぶ', () => {
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
  it('写真が2枚以上ある部位のみ返す(occasion数ではなく単純な枚数)', () => {
    const photos = [
      photo({ id: 'a', bodyPart: 'face_front', takenAt: '2026-09-17T01:00:00Z' }),
      photo({ id: 'b', bodyPart: 'face_front', takenAt: '2026-09-17T01:05:00Z' }),
      photo({ id: 'c', bodyPart: 'forehead', takenAt: '2026-09-01T00:00:00Z' }),
    ]
    expect(listComparableBodyParts(photos)).toEqual(['face_front'])
  })
})

describe('listPhotoOptions', () => {
  it('指定部位の個別写真を丸め込み無しですべて返す(同日3枚でも3件のまま)', () => {
    const photos = [
      photo({ id: 'front-3', bodyPart: 'face_front', takenAt: '2026-09-17T01:08:00Z' }),
      photo({ id: 'front-2', bodyPart: 'face_front', takenAt: '2026-09-17T01:05:00Z' }),
      photo({ id: 'front-1', bodyPart: 'face_front', takenAt: '2026-09-17T01:02:00Z' }),
      photo({ id: 'left45', bodyPart: 'face_left45', takenAt: '2026-09-17T01:00:00Z' }),
    ]
    const options = listPhotoOptions(photos, 'face_front')
    expect(options.map(o => o.photo.id)).toEqual(['front-3', 'front-2', 'front-1'])
  })

  it('該当部位が無ければ空配列', () => {
    expect(listPhotoOptions([], 'face_front')).toEqual([])
  })
})

describe('formatPhotoDateLabel', () => {
  it('本日を「本日」と表示する', () => {
    const { relative } = formatPhotoDateLabel(new Date().toISOString())
    expect(relative).toBe('本日')
  })

  it('日付をYYYY/MM/DD形式に整形する', () => {
    const { dateStr } = formatPhotoDateLabel('2026-03-15T00:00:00Z')
    expect(dateStr).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
  })

  it('時刻をHH:mm形式に整形する(同日複数枚を見分けるための表示用)', () => {
    const { timeStr } = formatPhotoDateLabel('2026-03-15T01:05:00Z')
    expect(timeStr).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('buildPhotoOptionLabels', () => {
  it('日付が重複しなければ時刻を付けない', () => {
    const options = [
      { photo: photo({ id: 'a', takenAt: '2026-09-01T00:00:00Z' }) },
      { photo: photo({ id: 'b', takenAt: '2026-08-01T00:00:00Z' }) },
    ]
    const labels = buildPhotoOptionLabels(options)
    expect(labels.every(l => !/\d{2}:\d{2}/.test(l))).toBe(true)
  })

  it('【同日・異時刻】日付が重複する場合は時刻を併記して区別する', () => {
    const options = [
      { photo: photo({ id: 'a', takenAt: '2026-09-17T01:08:00Z' }) },
      { photo: photo({ id: 'b', takenAt: '2026-09-17T01:05:00Z' }) },
    ]
    const labels = buildPhotoOptionLabels(options)
    expect(new Set(labels).size).toBe(2) // 2件とも一意
    expect(labels.every(l => /\d{2}:\d{2}/.test(l))).toBe(true)
  })

  it('【同日・同時刻の完全衝突】連番を付けて一意にする', () => {
    // 撮影日のみ指定して登録した過去写真が、taken_atまで完全一致するケースを想定
    const options = [
      { photo: photo({ id: 'a', takenAt: '2026-08-01T12:00:00.000Z' }) },
      { photo: photo({ id: 'b', takenAt: '2026-08-01T12:00:00.000Z' }) },
      { photo: photo({ id: 'c', takenAt: '2026-08-01T12:00:00.000Z' }) },
    ]
    const labels = buildPhotoOptionLabels(options)
    expect(new Set(labels).size).toBe(3) // 3件とも一意(連番により区別)
    expect(labels[0]).toMatch(/#1/)
    expect(labels[1]).toMatch(/#2/)
    expect(labels[2]).toMatch(/#3/)
  })
})

// ================================================================
// comparisonSelection.ts — Before/After左右比較の組み立てロジックのテスト
//
// 2026-09-06改訂: 撮影機会(occasion)単位のロジックへの変更に伴うテスト追加。
// - visit_idがある写真は同一visit_idを同一撮影機会とみなす
// - visit_idがnullの写真は同一日付を同一撮影機会とみなす
// - 同一撮影機会内に何枚あっても「前回」「初回」「今回」の水増しにならないこと
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  buildFirstComparison,
  buildPreviousComparison,
  comparableGroups,
  groupPhotosByBodyPart,
  hasDistinctFirstOccasion,
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

describe('comparableGroups(撮影機会が2つ以上のグループのみ残す)', () => {
  it('撮影機会が1つしかないグループを除外する(同日・visit_id無しの2枚は1撮影機会)', () => {
    const groups = groupPhotosByBodyPart([
      // 'nose': 同日・visit_id無しの2枚 → 撮影機会は1つだけ(比較不可)
      photo({ id: 'a', bodyPart: 'nose', takenAt: '2026-09-01T10:00:00Z' }),
      photo({ id: 'b', bodyPart: 'nose', takenAt: '2026-09-01T10:05:00Z' }),
      // 'chin': 1枚のみ(比較不可)
      photo({ id: 'c', bodyPart: 'chin' }),
      // 'forehead': 日付が異なる2枚 → 撮影機会2つ(比較可能)
      photo({ id: 'd', bodyPart: 'forehead', takenAt: '2026-09-05T00:00:00Z' }),
      photo({ id: 'e', bodyPart: 'forehead', takenAt: '2026-09-01T00:00:00Z' }),
    ])
    const result = comparableGroups(groups)
    expect(result.map(g => g.bodyPart)).toEqual(['forehead'])
  })
})

describe('buildPreviousComparison(撮影機会単位)', () => {
  it('先頭(最新の撮影機会)をcurrent、2番目の撮影機会をreferenceにしてbasis=previousを返す(単純ケース: 各撮影機会1枚ずつ)', () => {
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

describe('buildFirstComparison(撮影機会単位)', () => {
  it('先頭(最新の撮影機会)をcurrent、末尾(最古の撮影機会)をreferenceにしてbasis=firstを返す(単純ケース)', () => {
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

  it('撮影機会がちょうど2つの場合、current/referenceはbuildPreviousComparisonと同じになる(basisのみ異なる)', () => {
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

// ================================================================
// 撮影機会(occasion)単位ロジックの本題テスト(Test 1〜5)
// ================================================================

describe('撮影機会単位のロジック — Test 1: 同一visit_idに複数枚あるケース', () => {
  it('visit A(before×2+after×1)とvisit B(before×1+after×1)がある場合、今回=visit B・前回=visit Aとなり、visit A内の写真が別々の撮影機会に分裂しない', () => {
    // 顧客がvisit A(過去の来店)で3枚、visit B(直近の来店)で2枚撮っている想定。
    // 入力はAPIのtaken_at DESC前提に合わせ、新しい順で渡す。
    const visitBAfter   = photo({ id: 'b-after',  visitId: 'visit-b', photoType: 'after',  takenAt: '2026-09-06T14:05:00Z' })
    const visitBBefore  = photo({ id: 'b-before', visitId: 'visit-b', photoType: 'before', takenAt: '2026-09-06T14:00:00Z' })
    const visitAAfter   = photo({ id: 'a-after',  visitId: 'visit-a', photoType: 'after',  takenAt: '2026-09-01T10:05:00Z' })
    const visitABefore2 = photo({ id: 'a-before2', visitId: 'visit-a', photoType: 'before', takenAt: '2026-09-01T10:02:00Z' })
    const visitABefore1 = photo({ id: 'a-before1', visitId: 'visit-a', photoType: 'before', takenAt: '2026-09-01T10:00:00Z' })

    const group = {
      bodyPart: 'face_front',
      photos: [visitBAfter, visitBBefore, visitAAfter, visitABefore2, visitABefore1],
    }

    // 撮影機会は2つ(visit-a, visit-b)のみであるべき(5枚が5撮影機会に分裂してはいけない)
    expect(comparableGroups([group])).toHaveLength(1)
    expect(hasDistinctFirstOccasion(group)).toBe(false) // 撮影機会が2つなので初回=前回

    const pair = buildPreviousComparison(group)
    // 今回はvisit Bの代表写真、前回はvisit Aの代表写真であること(visit_idで判定)
    expect(pair.current.visitId).toBe('visit-b')
    expect(pair.reference.visitId).toBe('visit-a')
    // visit A内の「別の写真」が前回として選ばれること自体は問題ないが、
    // visit Aという1つの撮影機会からちょうど1枚だけが選ばれていること(分裂していないこと)を確認する
    expect(pair.reference).toBe(visitAAfter) // 撮影機会内でtaken_atが最新の1枚を代表写真として選ぶ実装
  })
})

describe('撮影機会単位のロジック — Test 2: visit_id=nullで同日複数枚(2つの撮影機会)', () => {
  it('2026-09-01の3枚(同日=1撮影機会)と2026-09-06の1枚(別撮影機会)がある場合、今回=09-06・前回=09-01となる', () => {
    const day1 = [
      photo({ id: 'd1-a', takenAt: '2026-09-01T10:00:00Z' }),
      photo({ id: 'd1-b', takenAt: '2026-09-01T10:05:00Z' }),
      photo({ id: 'd1-c', takenAt: '2026-09-01T10:10:00Z' }),
    ]
    const day2 = photo({ id: 'd2-a', takenAt: '2026-09-06T14:00:00Z' })

    // taken_at DESCで渡す
    const group = { bodyPart: 'nose', photos: [day2, ...[...day1].reverse()] }

    expect(comparableGroups([group])).toHaveLength(1)

    const pair = buildPreviousComparison(group)
    expect(pair.current.id).toBe('d2-a')
    expect(pair.current.takenAt.slice(0, 10)).toBe('2026-09-06')
    expect(pair.reference.takenAt.slice(0, 10)).toBe('2026-09-01')
    // 09-01の3枚のうち、どれか1枚だけが代表として選ばれていること
    expect(day1.map(p => p.id)).toContain(pair.reference.id)
  })
})

describe('撮影機会単位のロジック — Test 3: visit_id=nullで同日複数枚のみ(撮影機会1つ)', () => {
  it('2026-09-06の3枚だけの場合、比較対象なし(同一撮影機会内で初回/前回/今回を作らない)', () => {
    const group = {
      bodyPart: 'nose',
      photos: [
        photo({ id: 'a', takenAt: '2026-09-06T10:10:00Z' }),
        photo({ id: 'b', takenAt: '2026-09-06T10:05:00Z' }),
        photo({ id: 'c', takenAt: '2026-09-06T10:00:00Z' }),
      ],
    }
    expect(comparableGroups([group])).toEqual([])
  })
})

describe('撮影機会単位のロジック — Test 4: 初回比較(3つの撮影機会)', () => {
  it('visit A(2026-06-01)・visit B(2026-07-01)・visit C(2026-09-06)がそれぞれ複数枚ある場合、初回=visit A・今回=visit Cとなる', () => {
    const visitC = [
      photo({ id: 'c1', visitId: 'visit-c', takenAt: '2026-09-06T10:05:00Z' }),
      photo({ id: 'c2', visitId: 'visit-c', takenAt: '2026-09-06T10:00:00Z' }),
    ]
    const visitB = [
      photo({ id: 'b1', visitId: 'visit-b', takenAt: '2026-07-01T10:05:00Z' }),
      photo({ id: 'b2', visitId: 'visit-b', takenAt: '2026-07-01T10:00:00Z' }),
    ]
    const visitA = [
      photo({ id: 'a1', visitId: 'visit-a', takenAt: '2026-06-01T10:05:00Z' }),
      photo({ id: 'a2', visitId: 'visit-a', takenAt: '2026-06-01T10:00:00Z' }),
    ]
    const group = { bodyPart: 'nose', photos: [...visitC, ...visitB, ...visitA] }

    expect(comparableGroups([group])).toHaveLength(1)
    expect(hasDistinctFirstOccasion(group)).toBe(true) // 撮影機会が3つあるので初回≠前回

    const pair = buildFirstComparison(group)
    expect(pair.current.visitId).toBe('visit-c')
    expect(pair.reference.visitId).toBe('visit-a')
    // visit Aの2枚のうちどちらかが代表として選ばれ、visit Bが混入していないこと
    expect(visitA.map(p => p.id)).toContain(pair.reference.id)
  })
})

describe('撮影機会単位のロジック — Test 5: 同一visit_id内のbefore/after混在', () => {
  it('同一visit_id内にbefore×4+after×1がある場合、photo_typeに関わらず1つの撮影機会として扱われる(比較対象にならない)', () => {
    const group = {
      bodyPart: 'face_front',
      photos: [
        photo({ id: 'after1',   visitId: 'visit-x', photoType: 'after',  takenAt: '2026-09-06T10:20:00Z' }),
        photo({ id: 'before4',  visitId: 'visit-x', photoType: 'before', takenAt: '2026-09-06T10:15:00Z' }),
        photo({ id: 'before3',  visitId: 'visit-x', photoType: 'before', takenAt: '2026-09-06T10:10:00Z' }),
        photo({ id: 'before2',  visitId: 'visit-x', photoType: 'before', takenAt: '2026-09-06T10:05:00Z' }),
        photo({ id: 'before1',  visitId: 'visit-x', photoType: 'before', takenAt: '2026-09-06T10:00:00Z' }),
      ],
    }
    // 撮影機会は1つ(visit-x)のみなので、5枚あっても比較対象から除外される
    // (もしphoto_typeやtaken_atの違いで別撮影機会に分裂するバグがあれば、ここが2つ以上になり誤って比較可能になってしまう)
    expect(comparableGroups([group])).toEqual([])
  })
})

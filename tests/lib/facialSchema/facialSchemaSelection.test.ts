// ================================================================
// facialSchemaSelection.ts — 撮影機会(occasion)判定・「前回の記録」選択のテスト
//
// 写真機能(src/lib/photos/ghostSelection.ts)の excludingCurrentOccasion() と
// 同じ「今日これから記録する機会自身を前回として誤選択しない」ことを検証する。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  buildPreviousSchema,
  currentOccasionKey,
  excludingCurrentOccasion,
  sortRecordsDesc,
  toJstDateStr,
  todayJstDateStr,
  type FacialSchemaRecord,
} from '../../../src/lib/facialSchema/facialSchemaSelection'

function record(overrides: Partial<FacialSchemaRecord> = {}): FacialSchemaRecord {
  return { id: 'r1', visitId: null, schemaDate: '2026-09-01', ...overrides }
}

describe('toJstDateStr / todayJstDateStr', () => {
  it('UTC日付をJST(+9時間)の暦日へ変換する(日付が繰り上がるケース)', () => {
    // UTC 2026-09-01T15:30:00Z は JSTで2026-09-02T00:30:00(日付が変わる)
    expect(toJstDateStr(new Date('2026-09-01T15:30:00Z'))).toBe('2026-09-02')
  })

  it('日付が繰り上がらないケースではそのままの日付になる', () => {
    // UTC 2026-09-01T00:00:00Z は JSTで2026-09-01T09:00:00
    expect(toJstDateStr(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09-01')
  })

  it('境界値: UTC 14:59:59は繰り上がらず、15:00:00で繰り上がる', () => {
    expect(toJstDateStr(new Date('2026-09-01T14:59:59Z'))).toBe('2026-09-01')
    expect(toJstDateStr(new Date('2026-09-01T15:00:00Z'))).toBe('2026-09-02')
  })

  it('todayJstDateStrは引数で与えた基準時刻に対してtoJstDateStrと同じ結果を返す', () => {
    const now = new Date('2026-09-06T20:00:00Z')
    expect(todayJstDateStr(now)).toBe(toJstDateStr(now))
  })
})

describe('currentOccasionKey', () => {
  it('visitIdがあればvisit:形式のキーを返す', () => {
    expect(currentOccasionKey('visit-a', '2026-09-06')).toBe('visit:visit-a')
  })

  it('visitIdが無ければdate:形式のキー(JST日付)を返す', () => {
    expect(currentOccasionKey(null, '2026-09-06')).toBe('date:2026-09-06')
  })
})

describe('sortRecordsDesc', () => {
  it('schemaDateの新しい順に並べ替える', () => {
    const records = [
      record({ id: 'old', schemaDate: '2026-08-01' }),
      record({ id: 'new', schemaDate: '2026-09-06' }),
      record({ id: 'mid', schemaDate: '2026-09-01' }),
    ]
    expect(sortRecordsDesc(records).map(r => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('元の配列は変更しない', () => {
    const records = [record({ id: 'a', schemaDate: '2026-08-01' }), record({ id: 'b', schemaDate: '2026-09-01' })]
    const original = [...records]
    sortRecordsDesc(records)
    expect(records).toEqual(original)
  })
})

describe('excludingCurrentOccasion', () => {
  it('visit_idが一致するレコードを除外する', () => {
    const records = [
      record({ id: 'today', visitId: 'visit-x', schemaDate: '2026-09-06' }),
      record({ id: 'previous', visitId: 'visit-y', schemaDate: '2026-08-01' }),
    ]
    const result = excludingCurrentOccasion(records, 'visit-x', '2026-09-06')
    expect(result.map(r => r.id)).toEqual(['previous'])
  })

  it('currentVisitIdがnullの場合、同じJST日付(visit_id無し)のレコードを除外する', () => {
    // iPad撮影時点でbrain_visitsが未作成の間はcurrentVisitId=nullになる(写真機能と同じ制約)。
    const records = [
      record({ id: 'today-1', visitId: null, schemaDate: '2026-09-06' }),
      record({ id: 'today-2', visitId: null, schemaDate: '2026-09-06' }),
      record({ id: 'previous', visitId: null, schemaDate: '2026-09-01' }),
    ]
    const result = excludingCurrentOccasion(records, null, '2026-09-06')
    expect(result.map(r => r.id)).toEqual(['previous'])
  })

  it('visit_idありのレコードとvisit_id無し(別日)のレコードは区別される', () => {
    const records = [
      record({ id: 'today', visitId: 'visit-x', schemaDate: '2026-09-06' }),
      record({ id: 'other-day-null-visit', visitId: null, schemaDate: '2026-09-06' }),
    ]
    // currentがvisit-xの場合、visit_id無しの同日レコードは別occasionとして残る
    // (comparisonSelection.tsで既知の限界として明記されているのと同じ仕様)
    const result = excludingCurrentOccasion(records, 'visit-x', '2026-09-06')
    expect(result.map(r => r.id)).toEqual(['other-day-null-visit'])
  })
})

describe('buildPreviousSchema', () => {
  it('現在編集中の機会を除いた最新のレコードを返す', () => {
    const records = [
      record({ id: 'today', visitId: null, schemaDate: '2026-09-06' }),
      record({ id: 'previous', visitId: 'visit-b', schemaDate: '2026-09-01' }),
      record({ id: 'oldest', visitId: 'visit-a', schemaDate: '2026-08-01' }),
    ]
    const result = buildPreviousSchema(records, null, '2026-09-06')
    expect(result?.id).toBe('previous')
  })

  it('今日自身の記録しか無い場合はnullを返す', () => {
    const records = [record({ id: 'today', visitId: null, schemaDate: '2026-09-06' })]
    expect(buildPreviousSchema(records, null, '2026-09-06')).toBeNull()
  })

  it('レコードが1件も無い場合はnullを返す', () => {
    expect(buildPreviousSchema([], null, '2026-09-06')).toBeNull()
  })

  it('todayJstを省略した場合は現在時刻ベースのJST日付を既定値として使う', () => {
    // 呼び出し時点のtodayJstDateStr()と同じ日付のレコードは「今日」として除外されるはず。
    const today = todayJstDateStr()
    const records = [record({ id: 'today', visitId: null, schemaDate: today })]
    expect(buildPreviousSchema(records, null)).toBeNull()
  })
})

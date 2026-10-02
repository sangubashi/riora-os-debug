import { describe, expect, it } from 'vitest'
import {
  buildScheduledAtJst, formatJstMonthDayTime, isPastDateTime, reservationsOverlap, splitJstDateTime, todayJstDate,
} from '../../../src/lib/reservations/reschedule'

describe('buildScheduledAtJst', () => {
  it('日付と時刻をJST(+09:00)のISO文字列にする', () => {
    expect(buildScheduledAtJst('2026-10-05', '14:30')).toBe('2026-10-05T14:30:00+09:00')
    expect(buildScheduledAtJst('2026-01-02', '09:05')).toBe('2026-01-02T09:05:00+09:00')
  })
  it('不正な日付・時刻・5分刻み以外は null', () => {
    expect(buildScheduledAtJst('2026-02-30', '10:00')).toBeNull()
    expect(buildScheduledAtJst('2026-10-05', '24:00')).toBeNull()
    expect(buildScheduledAtJst('2026-10-05', '10:07')).toBeNull()
    expect(buildScheduledAtJst('2026/10/05', '10:00')).toBeNull()
    expect(buildScheduledAtJst('', '')).toBeNull()
  })
})

describe('reservationsOverlap', () => {
  it('重なる/隣り合う/離れている', () => {
    expect(reservationsOverlap('2026-10-05T14:00:00+09:00', 60, '2026-10-05T14:30:00+09:00', 60)).toBe(true)
    expect(reservationsOverlap('2026-10-05T14:00:00+09:00', 60, '2026-10-05T15:00:00+09:00', 60)).toBe(false)
    expect(reservationsOverlap('2026-10-05T14:00:00+09:00', 60, '2026-10-05T13:00:00+09:00', 60)).toBe(false)
    expect(reservationsOverlap('2026-10-05T14:00:00+09:00', 90, '2026-10-05T15:00:00+09:00', 30)).toBe(true)
  })
})

describe('JST 表示用', () => {
  it('UTCの境界をまたいでもJSTの日付で扱う', () => {
    // 2026-10-04T15:30:00Z = JST 2026-10-05 00:30
    expect(splitJstDateTime('2026-10-04T15:30:00Z')).toEqual({ date: '2026-10-05', time: '00:30' })
    expect(formatJstMonthDayTime('2026-10-05T14:30:00+09:00')).toBe('10/5(月) 14:30')
    expect(todayJstDate(new Date('2026-10-04T15:30:00Z'))).toBe('2026-10-05')
  })
  it('過去判定', () => {
    expect(isPastDateTime('2000-01-01T00:00:00+09:00')).toBe(true)
    expect(isPastDateTime('2099-01-01T00:00:00+09:00')).toBe(false)
  })
})

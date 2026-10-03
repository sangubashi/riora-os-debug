import { describe, it, expect } from 'vitest'
import {
  groupPhotosByJstDate,
  toJstDateKey,
  formatJstTime,
  formatDateChipLabel,
  currentJstYear,
} from '@/lib/photos/groupPhotosByJstDate'

let seq = 0
const p = (bodyPart: string, takenAt: string, id?: string) => ({ id: id ?? `p${++seq}`, bodyPart, takenAt })

describe('JST日付境界', () => {
  it('UTCでは前日でも、JSTの0:00〜8:59は当日になる', () => {
    expect(toJstDateKey('2026-10-01T15:00:00Z')).toBe('2026-10-02') // JST 10/2 0:00
    expect(toJstDateKey('2026-10-01T23:59:00Z')).toBe('2026-10-02') // JST 10/2 8:59
    expect(toJstDateKey('2026-10-02T14:59:00Z')).toBe('2026-10-02') // JST 10/2 23:59
    expect(toJstDateKey('2026-10-02T15:00:00Z')).toBe('2026-10-03') // JST 10/3 0:00
  })
  it('UTC日付が同じでもJSTでは別の日として分かれる', () => {
    const g = groupPhotosByJstDate([
      p('face_front', '2026-10-02T10:00:00Z'), // JST 10/2 19:00
      p('face_front', '2026-10-02T16:00:00Z'), // JST 10/3 1:00
    ])
    expect(g.map(x => x.dateKey)).toEqual(['2026-10-03', '2026-10-02'])
  })
  it('JSTの朝(UTCでは前日)に撮った写真が前日にまとまらない', () => {
    const g = groupPhotosByJstDate([
      p('face_front', '2026-10-01T23:30:00Z'), // JST 10/2 8:30
      p('forehead', '2026-10-02T05:00:00Z'), // JST 10/2 14:00
    ])
    expect(g).toHaveLength(1)
    expect(g[0].dateKey).toBe('2026-10-02')
    expect(g[0].photos).toHaveLength(2)
  })
  it('解釈できない日付は無視し、時刻表示は空文字', () => {
    expect(toJstDateKey('not-a-date')).toBeNull()
    expect(groupPhotosByJstDate([p('face_front', 'xxx')])).toEqual([])
    expect(formatJstTime('xxx')).toBe('')
  })
  it('時刻はJSTのHH:mm', () => {
    expect(formatJstTime('2026-10-02T05:07:00Z')).toBe('14:07')
  })
})

describe('並び順', () => {
  it('日付は新しい順', () => {
    const g = groupPhotosByJstDate([
      p('face_front', '2026-09-10T03:00:00Z'),
      p('face_front', '2026-10-02T03:00:00Z'),
      p('face_front', '2026-09-25T03:00:00Z'),
    ])
    expect(g.map(x => x.dateKey)).toEqual(['2026-10-02', '2026-09-25', '2026-09-10'])
  })
  it('同日複数角度は 正面→右斜め→左斜め→額 の順', () => {
    const g = groupPhotosByJstDate([
      p('forehead', '2026-10-02T01:00:00Z'),
      p('face_left', '2026-10-02T02:00:00Z'),
      p('face_front', '2026-10-02T03:00:00Z'),
      p('face_right', '2026-10-02T04:00:00Z'),
    ])
    expect(g[0].photos.map(x => x.bodyPart)).toEqual(['face_front', 'face_right', 'face_left', 'forehead'])
  })
  it('同日同角度の複数枚は統合されず、撮影時刻の古い順で全て残る', () => {
    const g = groupPhotosByJstDate([
      p('face_front', '2026-10-02T05:00:00Z', 'late'),
      p('face_front', '2026-10-02T01:00:00Z', 'early'),
      p('face_right', '2026-10-02T03:00:00Z', 'r'),
    ])
    expect(g[0].photos.map(x => x.id)).toEqual(['early', 'late', 'r'])
  })
  it('旧データ・未知のbody_partも除外せず、既知の4角度の後ろに並ぶ', () => {
    const g = groupPhotosByJstDate([
      p('cheek_right', '2026-10-02T01:00:00Z', 'c'),
      p('face_left45', '2026-10-02T01:00:00Z', 'l45'),
      p('face_front', '2026-10-02T02:00:00Z', 'f'),
      p('something_new', '2026-10-02T01:00:00Z', 'x'),
    ])
    expect(g[0].photos.map(x => x.id)).toEqual(['f', 'c', 'l45', 'x'])
    expect(g[0].photos).toHaveLength(4)
  })
  it('入力配列を変更しない・写真が欠落しない', () => {
    const input = [p('forehead', '2026-10-02T01:00:00Z'), p('face_front', '2026-10-02T02:00:00Z')]
    const copy = [...input]
    const g = groupPhotosByJstDate(input)
    expect(input).toEqual(copy)
    expect(g.flatMap(x => x.photos)).toHaveLength(2)
  })
})

describe('日付チップ表示', () => {
  it('今年は月/日、別の年は年付き', () => {
    expect(formatDateChipLabel('2026-10-02', 2026)).toBe('10/2')
    expect(formatDateChipLabel('2025-12-31', 2026)).toBe('2025/12/31')
    expect(formatDateChipLabel('2026-09-05')).toBe('9/5')
  })
  it('currentJstYearはJSTの年(年末のUTC/JSTずれ)', () => {
    expect(currentJstYear(Date.parse('2026-12-31T15:00:00Z'))).toBe(2027)
  })
})

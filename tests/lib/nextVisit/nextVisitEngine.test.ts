import { describe, it, expect } from 'vitest'
import { computeNextVisit, formatWeeksLabel, formatApproxDateLabel } from '@/lib/nextVisit/nextVisitEngine'

describe('computeNextVisit', () => {
  it('①手動上書きが最優先(次回予約・来店履歴があっても上書きを採用)', () => {
    const result = computeNextVisit({
      overrideDate: '2026-12-25',
      nextReservationDate: '2026-10-01',
      visitDates: ['2026-08-01', '2026-08-29'],
      currentMenuName: '毛穴クリア',
      paymentType: 'per_visit',
    })
    expect(result.source).toBe('staff_override')
    expect(result.estimatedDate).toBe('2026-12-25')
  })

  it('②次回予約が2番目の優先度(上書きが無ければ予約日を採用)', () => {
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: '2026-10-01',
      visitDates: ['2026-08-01', '2026-08-29'],
      currentMenuName: '毛穴クリア',
      paymentType: 'per_visit',
    })
    expect(result.source).toBe('next_reservation')
    expect(result.estimatedDate).toBe('2026-10-01')
  })

  it('③来店間隔の中央値から算出する(奇数件)', () => {
    // 間隔: 8/1→8/29=28日, 8/29→9/28=30日, 9/28→10/26=28日 → 中央値28日
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: ['2026-08-01', '2026-08-29', '2026-09-28', '2026-10-26'],
      currentMenuName: '毛穴クリア',
      paymentType: 'per_visit',
    })
    expect(result.source).toBe('interval_calculated')
    expect(result.cycleDays).toBe(28)
    expect(result.sampleSize).toBe(4)
    expect(result.estimatedDate).toBe('2026-11-23') // 10/26 + 28日
    expect(result.basisLabel).toContain('過去4回')
    expect(result.basisLabel).toContain('中央値28日')
  })

  it('③1件の極端な外れ値に引っ張られない(中央値の頑健性)', () => {
    // 間隔: 30日, 30日, 200日(外れ値) → 中央値は30日(平均だと外れ値に引っ張られる)
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: ['2026-01-01', '2026-07-19', '2026-08-18', '2026-09-17'],
      currentMenuName: '毛穴クリア',
      paymentType: 'per_visit',
    })
    expect(result.cycleDays).toBe(30)
  })

  it('③サブスク契約者には根拠テキストに付記する', () => {
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: ['2026-08-01', '2026-08-29'],
      currentMenuName: null,
      paymentType: 'subscription',
    })
    expect(result.basisLabel).toContain('サブスク')
  })

  it('④来店1回のみはメニュー別デフォルトにフォールバックする', () => {
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: ['2026-08-01'],
      currentMenuName: '毛穴クリア',
      paymentType: 'per_visit',
    })
    expect(result.source).toBe('menu_default')
    expect(result.cycleDays).toBe(28) // 毛穴パターン
    expect(result.estimatedDate).toBe('2026-08-29')
  })

  it('④メニュー名が無い場合はデフォルト35日', () => {
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: ['2026-08-01'],
      currentMenuName: null,
      paymentType: 'per_visit',
    })
    expect(result.cycleDays).toBe(35)
  })

  it('来店履歴が0件はデータ不足を返す', () => {
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: [],
      currentMenuName: null,
      paymentType: 'per_visit',
    })
    expect(result.source).toBe('insufficient_data')
    expect(result.estimatedDate).toBeNull()
  })

  it('来店日を6件渡しても直近5件のみを使う', () => {
    const result = computeNextVisit({
      overrideDate: null,
      nextReservationDate: null,
      visitDates: [
        '2026-01-01', // これは使われない(古すぎる)
        '2026-06-01', '2026-07-01', '2026-08-01', '2026-08-31', '2026-10-01',
      ],
      currentMenuName: null,
      paymentType: 'per_visit',
    })
    expect(result.sampleSize).toBe(5)
  })
})

describe('formatWeeksLabel', () => {
  it('日数から週数表示に変換する', () => {
    expect(formatWeeksLabel(28)).toBe('約4週間後')
    expect(formatWeeksLabel(7)).toBe('約1週間後')
  })

  it('0日以下は特別な表示にする', () => {
    expect(formatWeeksLabel(0)).toBe('本日以降')
    expect(formatWeeksLabel(-5)).toBe('本日以降')
  })
})

describe('formatApproxDateLabel', () => {
  it('ISO日付を「6月9日頃」形式に整形する', () => {
    expect(formatApproxDateLabel('2026-06-09')).toBe('6月9日頃')
  })
})

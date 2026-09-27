import { describe, expect, it } from 'vitest'
import { sumSubscriptionSales, type SubscriptionPaymentRecord } from '@/lib/subscriptionSales/sumSubscriptionSales'

const PAYMENTS: SubscriptionPaymentRecord[] = [
  { staffId: 'staff-1', amount: 8000, paymentDate: '2026-09-05' },
  { staffId: 'staff-2', amount: 8000, paymentDate: '2026-09-10' },
  { staffId: null, amount: 8000, paymentDate: '2026-09-15' },
  { staffId: 'staff-1', amount: 8000, paymentDate: '2026-08-31' }, // 期間外(前月)
]

describe('sumSubscriptionSales', () => {
  it('期間内(両端含む)の全決済を合算する', () => {
    expect(sumSubscriptionSales(PAYMENTS, '2026-09-01', '2026-09-27')).toBe(24000)
  })

  it('staffIdを指定するとそのスタッフ担当分のみ合算する', () => {
    expect(sumSubscriptionSales(PAYMENTS, '2026-09-01', '2026-09-27', 'staff-1')).toBe(8000)
  })

  it('staffIdがnullの決済はstaffId指定時には含まれない', () => {
    expect(sumSubscriptionSales(PAYMENTS, '2026-09-01', '2026-09-27', 'staff-3')).toBe(0)
  })

  it('期間外の決済は含まれない', () => {
    expect(sumSubscriptionSales(PAYMENTS, '2026-09-01', '2026-09-27', 'staff-1')).not.toBe(16000)
  })

  it('該当が無ければ0を返す', () => {
    expect(sumSubscriptionSales([], '2026-09-01', '2026-09-27')).toBe(0)
  })
})

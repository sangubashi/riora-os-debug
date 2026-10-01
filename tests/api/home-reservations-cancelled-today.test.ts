// ================================================================
// GET /api/home/reservations — cancelledToday(当日キャンセル)追加の受入テスト
//
// 当日キャンセル機能(2026-10-01)。通常のreservations(status<>'cancelled'・既存仕様)は
// そのままに、cancelled_at(キャンセル日時)が本日(JST)のcancelledを別配列で返す。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'
import { createFakeSupabase } from './_helpers/fakeSupabase'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../app/lib/repos', () => ({ getServiceClient: vi.fn() }))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { getServiceClient } from '../../app/lib/repos'
import { GET } from '../../app/api/home/reservations/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockGetClient    = vi.mocked(getServiceClient)

const ADMIN: RequestingStaff = {
  authUserId: 'admin-1', staffBrainId: null, email: 'admin@salon-riora.jp', isAdmin: true,
}

const customer = (id: string, name: string) => ({
  id, name, customer_type: null, churn_score: 0, is_subscriber: false, skin_tags: [], is_internal_user: false,
})

function reservation(id: string, custId: string, over: Record<string, unknown> = {}) {
  return {
    id, brain_customer_id: custId, staff_id: 'staff-a', menu: '毛穴ケア', price: 5000,
    scheduled_at: '2026-10-01T01:00:00+00:00', duration_minutes: 60, status: 'confirmed',
    is_new_customer: false, notes: null, created_at: '2026-09-30T00:00:00+00:00',
    brain_customer: customer(custId, `顧客${custId}`), ...over,
  }
}

function callGet() {
  return GET(new NextRequest('http://localhost/api/home/reservations'))
}

afterEach(() => { vi.clearAllMocks() })

describe('GET /api/home/reservations cancelledToday', () => {
  it('通常予約はreservations、当日キャンセル(cancelled_atが本日)はcancelledTodayに分けて返す', async () => {
    mockExtractStaff.mockResolvedValue(ADMIN)
    const fake = createFakeSupabase({
      reservations: [
        { data: [reservation('r1', 'c1'), reservation('r2', 'c2')], error: null },
        {
          data: [reservation('r3', 'c3', {
            status: 'cancelled', cancelled_at: '2026-10-01T05:32:00+00:00', cancel_source: 'manual',
          })],
          error: null,
        },
      ],
    })
    mockGetClient.mockReturnValue(fake as unknown as ReturnType<typeof getServiceClient>)

    const json = await (await callGet()).json()

    expect(json.reservations.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2'])
    expect(json.cancelledToday.map((r: { id: string }) => r.id)).toEqual(['r3'])
    expect(json.cancelledToday[0].cancel_source).toBe('manual')

    // 通常予約クエリ: 既存仕様(status<>'cancelled')のまま
    const main = fake.chainFor('reservations', 0)
    expect(main.neq).toHaveBeenCalledWith('status', 'cancelled')
    // 当日キャンセルクエリ: 「予約日」ではなく「cancelled_at」(キャンセル日時)が本日JSTで絞られる
    const cancelled = fake.chainFor('reservations', 1)
    expect(cancelled.eq).toHaveBeenCalledWith('status', 'cancelled')
    expect(cancelled.gte).toHaveBeenCalledWith('cancelled_at', expect.stringMatching(/T00:00:00\+09:00$/))
    expect(cancelled.lte).toHaveBeenCalledWith('cancelled_at', expect.stringMatching(/T23:59:59\+09:00$/))
    expect(cancelled.gte).not.toHaveBeenCalledWith('scheduled_at', expect.anything())
  })

  it('当日キャンセルが無ければcancelledTodayは空配列(reservationsは従来どおり)', async () => {
    mockExtractStaff.mockResolvedValue(ADMIN)
    const fake = createFakeSupabase({
      reservations: [{ data: [reservation('r1', 'c1')], error: null }, { data: [], error: null }],
    })
    mockGetClient.mockReturnValue(fake as unknown as ReturnType<typeof getServiceClient>)

    const json = await (await callGet()).json()
    expect(json.reservations).toHaveLength(1)
    expect(json.cancelledToday).toEqual([])
  })

  it('cancelledTodayの取得に失敗しても(カラム未適用等)、通常予約の返却は壊れない', async () => {
    mockExtractStaff.mockResolvedValue(ADMIN)
    const fake = createFakeSupabase({
      reservations: [
        { data: [reservation('r1', 'c1')], error: null },
        { data: null, error: { message: 'column reservations.cancelled_at does not exist' } },
      ],
    })
    mockGetClient.mockReturnValue(fake as unknown as ReturnType<typeof getServiceClient>)

    const res = await callGet()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.reservations).toHaveLength(1)
    expect(json.cancelledToday).toEqual([])
  })

  it('内部ユーザーのキャンセルは当日キャンセルにも出さない', async () => {
    mockExtractStaff.mockResolvedValue(ADMIN)
    const internal = reservation('r9', 'c9', {
      status: 'cancelled', cancelled_at: '2026-10-01T05:00:00+00:00',
      brain_customer: { ...customer('c9', '内部'), is_internal_user: true },
    })
    const fake = createFakeSupabase({
      reservations: [{ data: [], error: null }, { data: [internal], error: null }],
    })
    mockGetClient.mockReturnValue(fake as unknown as ReturnType<typeof getServiceClient>)

    const json = await (await callGet()).json()
    expect(json.cancelledToday).toEqual([])
  })

  it('一般スタッフは当日キャンセルも自分の担当(staff_id)に絞られる', async () => {
    mockExtractStaff.mockResolvedValue({
      authUserId: 'staff-a', staffBrainId: 'bs-1', email: 'a@example.com', isAdmin: false,
    })
    const fake = createFakeSupabase({ reservations: [{ data: [], error: null }, { data: [], error: null }] })
    mockGetClient.mockReturnValue(fake as unknown as ReturnType<typeof getServiceClient>)

    await callGet()
    expect(fake.chainFor('reservations', 1).eq).toHaveBeenCalledWith('staff_id', 'staff-a')
  })

  it('未認証は401', async () => {
    mockExtractStaff.mockResolvedValue(null)
    expect((await callGet()).status).toBe(401)
  })
})

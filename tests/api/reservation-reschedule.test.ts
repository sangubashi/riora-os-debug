// ================================================================
// POST /api/reservations/[id]/reschedule ルートレベル受入テスト(2026-10-02・「別日に予約」)
//
//   新しい日時の予約を作成 → 元の予約を「変更」(cancelled / cancel_source='manual')にする。
//   元の予約は削除しない。2つ目の書き込みが失敗したら、作った予約を削除して元に戻す。
//   権限(401/403)・顧客不一致・状態不正(409)・過去日時/不正日時(400)・同日時・重なり(409)を拒否する。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../app/lib/repos', () => ({ getServiceClient: vi.fn() }))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { getServiceClient } from '../../app/lib/repos'
import { SHARED_IPAD_STAFF_USER_ID } from '../../src/lib/constants'
import { POST } from '../../app/api/reservations/[id]/reschedule/route'

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}
const RES_ID = '33333333-3333-4333-8333-333333333333'
const CUST_ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID = '44444444-4444-4444-8444-444444444444'

// テストが「今日より先」になるよう、現在から十分先の日付を使う。
const FUTURE_DATE = '2099-01-15'

interface DbRow {
  id: string; customer_id: string | null; brain_customer_id: string | null; staff_id: string
  menu: string; price: number; scheduled_at: string; duration_minutes: number; status: string
  is_new_customer: boolean; notes: string | null; customer_hash_id: string | null
  cancelled_at?: string | null; cancel_source?: string | null
}

function baseRow(over: Partial<DbRow> = {}): DbRow {
  return {
    id: RES_ID, customer_id: null, brain_customer_id: CUST_ID, staff_id: STAFF.authUserId,
    menu: 'ヒト幹細胞ベーシック', price: 13000, scheduled_at: '2099-01-10T10:00:00+09:00',
    duration_minutes: 60, status: 'confirmed', is_new_customer: false, notes: '元メモ', customer_hash_id: null,
    ...over,
  }
}

interface Recorder {
  inserted: Record<string, unknown>[]
  updates: Record<string, unknown>[]
  deletedIds: string[]
}

/**
 * reservationsのフェイク。select(読み取り)・近隣予約の検索(in/neq/gte/lte)・insert→select→single・
 * update→eq(複数)→select(現在の行と条件が全て一致したときだけ更新)・delete→eq を再現する。
 */
function installDb(original: DbRow, opts: { nearby?: { id: string; scheduled_at: string; duration_minutes: number }[]; failUpdate?: boolean; insertError?: boolean } = {}) {
  const rec: Recorder = { inserted: [], updates: [], deletedIds: [] }
  const state = { row: { ...original } }
  const from = vi.fn(() => ({
    select: (cols: string) => {
      const isNearby = cols.includes('duration_minutes') && !cols.includes('brain_customer_id')
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.in = () => chain
      chain.neq = () => chain
      chain.gte = () => chain
      chain.lte = () => chain
      chain.maybeSingle = async () => ({ data: { ...state.row }, error: null })
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: isNearby ? (opts.nearby ?? []) : [], error: null }).then(resolve)
      return chain
    },
    insert: (row: Record<string, unknown>) => {
      rec.inserted.push(row)
      return {
        select: () => ({
          single: async () => opts.insertError
            ? { data: null, error: { message: 'insert_failed' } }
            : { data: { id: NEW_ID }, error: null },
        }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      const filters: [string, unknown][] = []
      const chain: Record<string, unknown> = {}
      chain.eq = (c: string, v: unknown) => { filters.push([c, v]); return chain }
      chain.select = async () => {
        if (opts.failUpdate) return { data: [], error: null }
        const ok = filters.every(([c, v]) => (state.row as unknown as Record<string, unknown>)[c] === v)
        if (!ok) return { data: [], error: null }
        Object.assign(state.row, patch)
        rec.updates.push(patch)
        return { data: [{ id: state.row.id }], error: null }
      }
      return chain
    },
    delete: () => ({
      eq: async (_c: string, v: string) => { rec.deletedIds.push(v); return { error: null } },
    }),
  }))
  vi.mocked(getServiceClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceClient>)
  return { rec, state }
}

function call(body: unknown, id = RES_ID) {
  const req = new NextRequest(`http://localhost/api/reservations/${id}/reschedule`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

const ok = { date: FUTURE_DATE, time: '14:30' }

afterEach(() => vi.clearAllMocks())
function allow() {
  vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
  vi.mocked(canAccessCustomer).mockResolvedValue(true)
}

describe('POST /api/reservations/[id]/reschedule', () => {
  it('未認証は401、予約IDがUUIDでなければ400', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    expect((await call(ok)).status).toBe(401)
    allow()
    expect((await call(ok, 'not-a-uuid')).status).toBe(400)
  })

  it('不正な日時・過去日時・元と同じ日時は400で、何も書き込まない', async () => {
    allow()
    const { rec } = installDb(baseRow())
    expect((await call({ date: '2099-02-30', time: '10:00' })).status).toBe(400)
    expect((await call({ date: FUTURE_DATE, time: '25:00' })).status).toBe(400)
    expect((await call({ date: FUTURE_DATE, time: '10:03' })).status).toBe(400) // 5分刻み以外
    const past = await call({ date: '2000-01-01', time: '10:00' })
    expect(past.status).toBe(400)
    expect((await past.json() as { error: string }).error).toBe('past_datetime')
    const same = await call({ date: '2099-01-10', time: '10:00' })
    expect((await same.json() as { error: string }).error).toBe('same_datetime')
    expect(rec.inserted).toHaveLength(0)
    expect(rec.updates).toHaveLength(0)
  })

  it('アクセス権なし/他人の担当予約は403、顧客不一致は409', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF)
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    installDb(baseRow())
    expect((await call(ok)).status).toBe(403)

    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    installDb(baseRow({ staff_id: 'someone-else' }))
    expect((await call(ok)).status).toBe(403)

    installDb(baseRow())
    expect((await call({ ...ok, brainCustomerId: '99999999-9999-4999-8999-999999999999' })).status).toBe(409)
  })

  it('iPad店舗共通ログインは他スタッフの予約も移せる', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue({ ...STAFF, authUserId: SHARED_IPAD_STAFF_USER_ID })
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    installDb(baseRow({ staff_id: 'someone-else' }))
    expect((await call(ok)).status).toBe(201)
  })

  it('変更済み・完了済みの予約は移せない(409)', async () => {
    allow()
    for (const status of ['cancelled', 'completed', 'in_progress']) {
      const { rec } = installDb(baseRow({ status }))
      const res = await call(ok)
      expect(res.status).toBe(409)
      expect(rec.inserted).toHaveLength(0)
    }
  })

  it('正常系: 同じ顧客・担当・メニュー・所要時間で新しい日時の予約を作り、元の予約を「変更」にする(削除しない)', async () => {
    allow()
    const { rec, state } = installDb(baseRow())
    const res = await call(ok)
    expect(res.status).toBe(201)
    const json = await res.json() as { created: { id: string; scheduled_at: string }; original: { status: string; cancel_source: string } }

    expect(rec.inserted).toHaveLength(1)
    expect(rec.inserted[0]).toMatchObject({
      brain_customer_id: CUST_ID, staff_id: STAFF.authUserId, menu: 'ヒト幹細胞ベーシック', price: 13000,
      duration_minutes: 60, status: 'confirmed', scheduled_at: `${FUTURE_DATE}T14:30:00+09:00`,
    })
    expect(String(rec.inserted[0].notes)).toContain('元メモ')
    expect(String(rec.inserted[0].notes)).toContain('別日に予約')

    expect(state.row.status).toBe('cancelled')
    expect(state.row.cancel_source).toBe('manual')
    expect(rec.updates[0].cancelled_at).toEqual(expect.any(String))
    expect(rec.deletedIds).toHaveLength(0)
    expect(json.created).toMatchObject({ id: NEW_ID, scheduled_at: `${FUTURE_DATE}T14:30:00+09:00` })
    expect(json.original).toMatchObject({ status: 'cancelled', cancel_source: 'manual' })
  })

  it('担当スタッフの別予約と時間が重なるときは409(slot_conflict)。allowOverlapなら予約できる', async () => {
    allow()
    const nearby = [{ id: 'other', scheduled_at: `${FUTURE_DATE}T14:00:00+09:00`, duration_minutes: 60 }] // 14:00-15:00 と 14:30-15:30 は重なる
    const first = installDb(baseRow(), { nearby })
    const res = await call(ok)
    expect(res.status).toBe(409)
    expect((await res.json() as { error: string }).error).toBe('slot_conflict')
    expect(first.rec.inserted).toHaveLength(0)

    installDb(baseRow(), { nearby })
    expect((await call({ ...ok, allowOverlap: true })).status).toBe(201)

    // 隣り合う(15:00開始)は重ならない
    installDb(baseRow(), { nearby: [{ id: 'other', scheduled_at: `${FUTURE_DATE}T13:30:00+09:00`, duration_minutes: 60 }] })
    expect((await call(ok)).status).toBe(201)
  })

  it('元の予約の更新に失敗(他端末で先に変更済み)したら、作った予約を削除して元に戻し409', async () => {
    allow()
    const { rec, state } = installDb(baseRow(), { failUpdate: true })
    const res = await call(ok)
    expect(res.status).toBe(409)
    expect(rec.inserted).toHaveLength(1)
    expect(rec.deletedIds).toEqual([NEW_ID])
    expect(state.row.status).toBe('confirmed')
  })

  it('新しい予約の作成に失敗したら500で、元の予約は変更しない', async () => {
    allow()
    const { rec, state } = installDb(baseRow(), { insertError: true })
    expect((await call(ok)).status).toBe(500)
    expect(rec.updates).toHaveLength(0)
    expect(state.row.status).toBe('confirmed')
  })
})

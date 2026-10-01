// ================================================================
// PATCH /api/reservations/[id]/cancel ルートレベル受入テスト
//
// 当日キャンセル機能(2026-10-01・/karte)。予約は削除せずstatus/cancelled_at/cancel_sourceのみ更新する。
//   confirmed → (cancel) → cancelled + cancelled_at + cancel_source='manual'
//   cancelled(manual) → (restore) → confirmed + cancelled_at=NULL + cancel_source=NULL
// 不正な状態遷移・二重送信・権限外・顧客不一致は409/403で拒否する。
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
import { PATCH } from '../../app/api/reservations/[id]/cancel/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockGetClient    = vi.mocked(getServiceClient)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}
const RES_ID = '33333333-3333-4333-8333-333333333333'
const CUST_ID = '11111111-1111-4111-8111-111111111111'

interface Row {
  id: string
  brain_customer_id: string | null
  staff_id: string | null
  status: string
  cancelled_at: string | null
  cancel_source: string | null
}

/**
 * reservationsの1行を持つステートフルなフェイク。select→maybeSingle と
 * update().eq()...select() (eqの条件が全て現在の行と一致したときだけ更新して1行返す)を再現する。
 * raceBeforeUpdate=trueの場合、selectで読んだ後・updateの前に別リクエストがstatusを変えた状況を再現する。
 */
function createFakeDb(initial: Row, opts: { raceBeforeUpdate?: boolean } = {}) {
  const state = { row: { ...initial }, updates: [] as Record<string, unknown>[] }
  const from = vi.fn(() => ({
    select: () => {
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.maybeSingle = async () => {
        const snapshot = { ...state.row }
        if (opts.raceBeforeUpdate) state.row.status = 'cancelled' // 読み取り後に他端末が先に更新
        return { data: snapshot, error: null }
      }
      return chain
    },
    update: (patch: Record<string, unknown>) => {
      const filters: [string, unknown][] = []
      const chain: Record<string, unknown> = {}
      chain.eq = (col: string, val: unknown) => { filters.push([col, val]); return chain }
      chain.select = async () => {
        const matches = filters.every(([c, v]) => (state.row as unknown as Record<string, unknown>)[c] === v)
        if (!matches) return { data: [], error: null }
        Object.assign(state.row, patch)
        state.updates.push(patch)
        return { data: [{ id: state.row.id }], error: null }
      }
      return chain
    },
  }))
  mockGetClient.mockReturnValue({ from } as unknown as ReturnType<typeof getServiceClient>)
  return state
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: RES_ID, brain_customer_id: CUST_ID, staff_id: STAFF.authUserId,
    status: 'confirmed', cancelled_at: null, cancel_source: null, ...over,
  }
}

function patchRoute(body: unknown, id = RES_ID) {
  const req = new NextRequest(`http://localhost/api/reservations/${id}/cancel`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ id }) })
}

function authorize(staff: RequestingStaff = STAFF, accessible = true) {
  mockExtractStaff.mockResolvedValue(staff)
  mockCanAccess.mockResolvedValue(accessible)
}

afterEach(() => { vi.clearAllMocks() })

describe('PATCH /api/reservations/[id]/cancel', () => {
  it('cancel: confirmed → cancelled / cancelled_atがセットされ / cancel_source=manual(予約は削除されない)', async () => {
    authorize()
    const db = createFakeDb(row())
    const res = await patchRoute({ action: 'cancel', brainCustomerId: CUST_ID })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(db.row.status).toBe('cancelled')
    expect(db.row.cancel_source).toBe('manual')
    expect(typeof db.row.cancelled_at).toBe('string')
    expect(Number.isNaN(new Date(db.row.cancelled_at as string).getTime())).toBe(false)
    // 日時・顧客・スタッフ等には触れていない(更新ペイロードはこの3項目のみ)
    expect(Object.keys(db.updates[0]).sort()).toEqual(['cancel_source', 'cancelled_at', 'status'])
    expect(db.row.id).toBe(RES_ID)
    expect(db.row.brain_customer_id).toBe(CUST_ID)
  })

  it('restore: 手動キャンセル済み → confirmed / cancelled_at・cancel_sourceがNULLへ戻る', async () => {
    authorize()
    const db = createFakeDb(row({ status: 'cancelled', cancelled_at: '2026-10-01T05:32:00Z', cancel_source: 'manual' }))
    const res = await patchRoute({ action: 'restore' })

    expect(res.status).toBe(200)
    expect(db.row.status).toBe('confirmed')
    expect(db.row.cancelled_at).toBeNull()
    expect(db.row.cancel_source).toBeNull()
    expect(Object.keys(db.updates[0]).sort()).toEqual(['cancel_source', 'cancelled_at', 'status'])
  })

  it('既にcancelledの予約へのcancelは409(already_cancelled)・更新されない', async () => {
    authorize()
    const db = createFakeDb(row({ status: 'cancelled', cancelled_at: '2026-10-01T05:32:00Z', cancel_source: 'manual' }))
    const res = await patchRoute({ action: 'cancel' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_cancelled')
    expect(db.updates).toHaveLength(0)
  })

  it('既にconfirmedの予約へのrestoreは409(not_cancelled)', async () => {
    authorize()
    const db = createFakeDb(row())
    const res = await patchRoute({ action: 'restore' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_cancelled')
    expect(db.updates).toHaveLength(0)
  })

  it('サロンボード由来(cancel_source未設定/salonboard_csv)のcancelledはrestoreできない(409 not_manual_cancel)', async () => {
    authorize()
    for (const source of [null, 'salonboard_csv']) {
      const db = createFakeDb(row({ status: 'cancelled', cancel_source: source }))
      const res = await patchRoute({ action: 'restore' })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('not_manual_cancel')
      expect(db.updates).toHaveLength(0)
    }
  })

  it('completed / in_progress の予約はcancelできない(409 invalid_status)', async () => {
    authorize()
    for (const status of ['completed', 'in_progress']) {
      const db = createFakeDb(row({ status }))
      const res = await patchRoute({ action: 'cancel' })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('invalid_status')
      expect(db.updates).toHaveLength(0)
    }
  })

  it('二重送信: 読み取り後に別リクエストが先にcancelしていた場合、updateはstatus条件で弾かれ409(conflict)', async () => {
    authorize()
    createFakeDb(row(), { raceBeforeUpdate: true })
    const res = await patchRoute({ action: 'cancel' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conflict')
  })

  it('不正なUUID形式の予約IDは、DBへ問い合わせず400(無効な予約ID形式です。)を返す', async () => {
    for (const badId of ['not-a-uuid', 'res-1', '12345', '33333333-3333-4333-8333-33333333333', "33333333-3333-4333-8333-333333333333'; drop table reservations;--"]) {
      authorize()
      const db = createFakeDb(row())
      mockGetClient.mockClear() // 以降のgetServiceClient呼び出し(=DBアクセス)の有無だけを見る
      const res = await patchRoute({ action: 'cancel' }, badId)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json).toEqual({ success: false, error: '無効な予約ID形式です。' })
      expect(mockGetClient).not.toHaveBeenCalled()
      expect(db.updates).toHaveLength(0)
      expect(db.row.status).toBe('confirmed')
    }
  })

  it('不正なUUID形式でも、認証なしなら先に401(IDの形式は認証後に検証される)', async () => {
    mockExtractStaff.mockResolvedValue(null)
    expect((await patchRoute({ action: 'cancel' }, 'not-a-uuid')).status).toBe(401)
  })

  it('認証なしは401', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await patchRoute({ action: 'cancel' })
    expect(res.status).toBe(401)
  })

  it('不正なaction・不正JSONは400', async () => {
    authorize()
    createFakeDb(row())
    expect((await patchRoute({ action: 'delete' })).status).toBe(400)
    expect((await patchRoute('not json')).status).toBe(400)
  })

  it('予約が存在しなければ404', async () => {
    authorize()
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }))
    mockGetClient.mockReturnValue({ from } as unknown as ReturnType<typeof getServiceClient>)
    const res = await patchRoute({ action: 'cancel' })
    expect(res.status).toBe(404)
  })

  it('顧客IDが予約の顧客と一致しなければ409(customer_mismatch)・更新されない', async () => {
    authorize()
    const db = createFakeDb(row())
    const res = await patchRoute({ action: 'cancel', brainCustomerId: '22222222-2222-4222-8222-222222222222' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('customer_mismatch')
    expect(db.updates).toHaveLength(0)
  })

  it('顧客に紐付かない予約(brain_customer_id=null)は409', async () => {
    authorize()
    createFakeDb(row({ brain_customer_id: null }))
    expect((await patchRoute({ action: 'cancel' })).status).toBe(409)
  })

  it('顧客へのアクセス権が無ければ403', async () => {
    authorize(STAFF, false)
    const db = createFakeDb(row())
    expect((await patchRoute({ action: 'cancel' })).status).toBe(403)
    expect(db.updates).toHaveLength(0)
  })

  it('一般スタッフは他スタッフ担当の予約を操作できない(403)', async () => {
    authorize()
    const db = createFakeDb(row({ staff_id: 'someone-else' }))
    expect((await patchRoute({ action: 'cancel' })).status).toBe(403)
    expect(db.updates).toHaveLength(0)
  })

  it('admin・iPad店舗共通ログインは担当に関係なく操作できる', async () => {
    for (const staff of [
      { ...STAFF, isAdmin: true },
      { ...STAFF, authUserId: SHARED_IPAD_STAFF_USER_ID },
    ]) {
      authorize(staff)
      const db = createFakeDb(row({ staff_id: 'someone-else' }))
      const res = await patchRoute({ action: 'cancel' })
      expect(res.status).toBe(200)
      expect(db.row.status).toBe('cancelled')
    }
  })
})

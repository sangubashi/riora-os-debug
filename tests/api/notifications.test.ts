import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'

vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))

// ── 簡易インメモリクエリビルダー(実装のフィルタ呼び出しをそのまま解釈して絞り込む) ──
type Row = Record<string, unknown>

function toTime(v: unknown): number {
  return new Date(v as string).getTime()
}

function makeQueryBuilder(rows: Row[]) {
  let filtered = rows.slice()
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, val: unknown) => { filtered = filtered.filter(r => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { filtered = filtered.filter(r => vals.includes(r[col])); return builder },
    is: (col: string, val: null) => { filtered = filtered.filter(r => (r[col] ?? null) === val); return builder },
    not: (col: string, _op: string, val: unknown) => { filtered = filtered.filter(r => (r[col] ?? null) !== val); return builder },
    gte: (col: string, val: unknown) => { filtered = filtered.filter(r => toTime(r[col]) >= toTime(val)); return builder },
    lte: (col: string, val: unknown) => { filtered = filtered.filter(r => toTime(r[col]) <= toTime(val)); return builder },
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: filtered, error: null }),
  }
  return builder
}

let tables: Record<string, Row[]> = {}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(tables[table] ?? []),
  }),
}))

const STAFF = { authUserId: 'staff-auth-uid', staffBrainId: 'staff-1', email: 'staff@example.com', isAdmin: true }

// 「本日」の範囲内に収まる固定時刻(JST 14:00)。todayJst()/tomorrowJst()はDate.now()基準のため、
// テスト実行時刻に依存せず常に「本日」となるよう、実行都度その日のJST14:00を採用する。
function todayAtJst(hour: number): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const date = jst.toISOString().split('T')[0]
  return `${date}T${String(hour).padStart(2, '0')}:00:00+09:00`
}

function baseReservation(overrides: Partial<Row>): Row {
  return {
    id: 'resv-1',
    brain_customer_id: 'cust-1',
    staff_id: 'staff-user-1',
    scheduled_at: todayAtJst(14),
    created_at: '2026-08-01T00:00:00+09:00',
    status: 'confirmed',
    customer_id: null,
    ...overrides,
  }
}

function buildReq(): NextRequest {
  return new NextRequest('http://localhost/api/notifications', { method: 'GET' })
}

describe('GET /api/notifications — 来店リマインドのstatusフィルタ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tables = {
      brain_customers: [],
      brain_visits: [],
      customer_memories: [],
      brain_skin_records: [],
      contraindications: [],
      brain_staff: [],
      reservations: [],
    }
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  })

  async function callAndGetVisitReminders() {
    const { GET } = await import('../../app/api/notifications/route')
    const res = await GET(buildReq())
    const json = await res.json() as { success: boolean; notifications: Array<{ kind: string; customerId: string }> }
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    return json.notifications.filter(n => n.kind === 'visit_reminder')
  }

  it('confirmedの予約は通知対象になる', async () => {
    tables.reservations = [baseReservation({ id: 'r1', status: 'confirmed' })]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(1)
    expect(reminders[0].customerId).toBe('cust-1')
  })

  it('in_progressの予約は通知対象になる', async () => {
    tables.reservations = [baseReservation({ id: 'r1', status: 'in_progress' })]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(1)
  })

  it('completedの予約は通知対象外になる', async () => {
    tables.reservations = [baseReservation({ id: 'r1', status: 'completed' })]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(0)
  })

  it('cancelledの予約は通知対象外になる', async () => {
    tables.reservations = [baseReservation({ id: 'r1', status: 'cancelled' })]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(0)
  })

  it('no_showの予約は通知対象外になる', async () => {
    tables.reservations = [baseReservation({ id: 'r1', status: 'no_show' })]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(0)
  })

  it('同一顧客にconfirmed+completedがある場合、confirmed側の通知だけになる(LEE JAEHEON様と同じ状況の再現)', async () => {
    tables.reservations = [
      baseReservation({ id: 'r-confirmed', status: 'confirmed', scheduled_at: todayAtJst(14) }),
      baseReservation({ id: 'r-completed', status: 'completed', scheduled_at: todayAtJst(15) }),
    ]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(1)
    expect(reminders[0].customerId).toBe('cust-1')
  })

  it('日時条件(本日〜明日の範囲)は従来通り機能する(範囲外の予約は対象外)', async () => {
    tables.reservations = [
      baseReservation({ id: 'r-old', status: 'confirmed', scheduled_at: '2020-01-01T14:00:00+09:00' }),
    ]
    const reminders = await callAndGetVisitReminders()
    expect(reminders).toHaveLength(0)
  })

  it('未認証は401のまま', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    const { GET } = await import('../../app/api/notifications/route')
    const res = await GET(buildReq())
    expect(res.status).toBe(401)
  })
})

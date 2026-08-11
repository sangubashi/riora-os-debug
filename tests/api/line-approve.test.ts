import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { lineSendDuplicateLimiter } from '@/lib/rateLimit'
import { sendLineMessage } from '../../app/lib/line/sender'

vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  lineSendDuplicateLimiter: { limit: vi.fn() },
}))
vi.mock('../../app/lib/line/sender', () => ({ sendLineMessage: vi.fn() }))

const insertCalls: Record<string, unknown>[] = []
const updateCalls: { table: string; values: Record<string, unknown> }[] = []
const queueRows: Record<string, unknown>[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'line_send_logs') {
        return {
          insert: (row: Record<string, unknown>) => {
            insertCalls.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'line_send_queue') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              single: () =>
                Promise.resolve({
                  data: queueRows.find((r) => r.id === val) ?? null,
                  error: queueRows.find((r) => r.id === val) ? null : { message: 'not found' },
                }),
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: (_col: string, val: string) => {
              updateCalls.push({ table, values })
              return Promise.resolve({
                data: null,
                error: queueRows.find((r) => r.id === val) ? null : { message: 'not found' },
              })
            },
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

const STAFF = { authUserId: 'staff-auth-uid', staffBrainId: 'staff-1', email: 'staff@example.com', isAdmin: false }
const ADMIN = { authUserId: 'admin-auth-uid', staffBrainId: null, email: 'admin@salon-riora.jp', isAdmin: true }

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/line/approve', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/line/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertCalls.length = 0
    updateCalls.length = 0
    queueRows.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    vi.mocked(lineSendDuplicateLimiter.limit).mockResolvedValue({
      success: true, limit: 1, remaining: 1, reset: Date.now() + 30_000,
    } as never)
  })

  it('① 担当顧客の場合はapprove成功し、LINE送信される', async () => {
    queueRows.push({ id: 'q-1', customer_id: 'cust-1', line_user_id: 'Uabc123', message_body: 'こんにちは' })
    vi.mocked(sendLineMessage).mockResolvedValue({ ok: true })

    const { POST } = await import('../../app/api/line/approve/route')
    const res = await POST(buildReq({ id: 'q-1', action: 'approve' }))
    const json = await res.json()

    expect(canAccessCustomer).toHaveBeenCalledWith('staff-1', 'cust-1', false)
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, newStatus: 'sent' })
    expect(sendLineMessage).toHaveBeenCalledWith('Uabc123', 'こんにちは')
  })

  it('② 担当外顧客の場合は403を返し、LINE送信されない(canAccessCustomer=false)', async () => {
    queueRows.push({ id: 'q-2', customer_id: 'cust-other', line_user_id: 'Uxyz999', message_body: 'こんにちは' })
    vi.mocked(canAccessCustomer).mockResolvedValue(false)

    const { POST } = await import('../../app/api/line/approve/route')
    const res = await POST(buildReq({ id: 'q-2', action: 'approve' }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json).toEqual({ success: false, error: 'forbidden' })
    expect(sendLineMessage).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })

  it('③ customer_id === null の場合、一般スタッフは403でLINE送信されない', async () => {
    queueRows.push({ id: 'q-3', customer_id: null, line_user_id: 'Utest001', message_body: 'テスト送信' })

    const { POST } = await import('../../app/api/line/approve/route')
    const res = await POST(buildReq({ id: 'q-3', action: 'approve' }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json).toEqual({ success: false, error: 'forbidden' })
    expect(canAccessCustomer).not.toHaveBeenCalled()
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('③b customer_id === null でもadminは許可され、LINE送信される', async () => {
    queueRows.push({ id: 'q-4', customer_id: null, line_user_id: 'Utest002', message_body: 'テスト送信' })
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN as never)
    vi.mocked(sendLineMessage).mockResolvedValue({ ok: true })

    const { POST } = await import('../../app/api/line/approve/route')
    const res = await POST(buildReq({ id: 'q-4', action: 'approve' }))
    const json = await res.json()

    expect(canAccessCustomer).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, newStatus: 'sent' })
    expect(sendLineMessage).toHaveBeenCalledWith('Utest002', 'テスト送信')
  })

  it('④ skip動作はcanAccessCustomerを呼ばず、従来どおり動作する', async () => {
    queueRows.push({ id: 'q-5', customer_id: 'cust-other', line_user_id: 'Uxyz999', message_body: 'こんにちは' })

    const { POST } = await import('../../app/api/line/approve/route')
    const res = await POST(buildReq({ id: 'q-5', action: 'skip' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, newStatus: 'skipped' })
    expect(canAccessCustomer).not.toHaveBeenCalled()
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    const { POST } = await import('../../app/api/line/approve/route')

    const res = await POST(buildReq({ id: 'q-1', action: 'approve' }))
    expect(res.status).toBe(401)
    expect(sendLineMessage).not.toHaveBeenCalled()
  })
})

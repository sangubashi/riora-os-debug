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
const lineUserIdsRows: Record<string, unknown>[] = []

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
      if (table === 'line_user_ids') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              is: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: lineUserIdsRows.find((r) => r.customer_id === val) ?? null,
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

const STAFF = { authUserId: 'staff-auth-uid', staffBrainId: 'staff-1', email: 'staff@example.com', isAdmin: false }

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/line/send', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/line/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertCalls.length = 0
    lineUserIdsRows.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    vi.mocked(lineSendDuplicateLimiter.limit).mockResolvedValue({
      success: true, limit: 1, remaining: 1, reset: Date.now() + 30_000,
    } as never)
  })

  it('未認証の場合は401を返し、送信を試みない', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    const { POST } = await import('../../app/api/line/send/route')

    const res = await POST(buildReq({ customerId: 'cust-1', body: 'こんにちは' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json).toEqual({ success: false, error: 'unauthorized' })
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('担当外顧客の場合は403を返し、送信を試みない(canAccessCustomer=false)', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    const { POST } = await import('../../app/api/line/send/route')

    const res = await POST(buildReq({ customerId: 'cust-other', body: 'こんにちは' }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json).toEqual({ success: false, error: 'forbidden' })
    expect(canAccessCustomer).toHaveBeenCalledWith('staff-1', 'cust-other', false)
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('customerIdが無い場合は400を返す', async () => {
    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq({ body: 'こんにちは' }))
    expect(res.status).toBe(400)
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('bodyが空の場合は400を返す', async () => {
    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq({ customerId: 'cust-1', body: '   ' }))
    expect(res.status).toBe(400)
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('不正なJSONの場合は400を返す', async () => {
    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq('not-json'))
    expect(res.status).toBe(400)
  })

  it('line_user_idが解決できない場合は404を返し、送信を試みない', async () => {
    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq({ customerId: 'cust-unknown', body: 'こんにちは' }))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json).toEqual({ success: false, error: 'line_user_id_not_found' })
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('正常系: line_user_idを解決しsendLineMessageを呼び、line_send_logsへ成功記録する', async () => {
    lineUserIdsRows.push({ customer_id: 'cust-1', line_user_id: 'Uabc123' })
    vi.mocked(sendLineMessage).mockResolvedValue({ ok: true })

    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq({ customerId: 'cust-1', body: 'こんにちは' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(sendLineMessage).toHaveBeenCalledWith('Uabc123', 'こんにちは')
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]).toMatchObject({
      mode: 'production',
      recipient_id: 'Uabc123',
      message_body: 'こんにちは',
      status: 'success',
    })
    expect((insertCalls[0].metadata as Record<string, unknown>).source).toBe('chat_direct')
  })

  it('二重送信はRate Limitで429を返し、送信を試みない', async () => {
    lineUserIdsRows.push({ customer_id: 'cust-1', line_user_id: 'Uabc123' })
    vi.mocked(lineSendDuplicateLimiter.limit).mockResolvedValue({
      success: false, limit: 1, remaining: 0, reset: Date.now() + 30_000,
    } as never)

    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq({ customerId: 'cust-1', body: 'こんにちは' }))
    const json = await res.json()

    expect(res.status).toBe(429)
    expect(json).toEqual({ success: false, error: 'duplicate_send_blocked' })
    expect(sendLineMessage).not.toHaveBeenCalled()
  })

  it('LINE送信失敗時は502を返し、line_send_logsへ失敗記録する(成功扱いにしない)', async () => {
    lineUserIdsRows.push({ customer_id: 'cust-1', line_user_id: 'Uabc123' })
    vi.mocked(sendLineMessage).mockResolvedValue({ ok: false, error: 'LINE API 401: invalid token' })

    const { POST } = await import('../../app/api/line/send/route')
    const res = await POST(buildReq({ customerId: 'cust-1', body: 'こんにちは' }))
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json).toEqual({ success: false, error: 'LINE API 401: invalid token' })
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].status).toBe('failed')
    expect(insertCalls[0].error_msg).toBe('LINE API 401: invalid token')
  })
})

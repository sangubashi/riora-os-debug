import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

const insertCalls: Record<string, unknown>[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'line_send_logs') {
        return {
          insert: (row: Record<string, unknown>) => {
            insertCalls.push(row)
            return Promise.resolve({ data: null, error: null })
          },
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

const CHANNEL_SECRET = 'test-channel-secret'

function sign(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64')
}

function buildReq(rawBody: string, signature: string): NextRequest {
  return new NextRequest('http://localhost/api/line/webhook', {
    method:  'POST',
    body:    rawBody,
    headers: { 'x-line-signature': signature },
  })
}

const rawBody = JSON.stringify({
  destination: 'dest-1',
  events: [
    { type: 'read', source: { type: 'user', userId: 'U1' }, timestamp: Date.now(), webhookEventId: 'evt-1' },
  ],
})

describe('POST /api/line/webhook - 署名検証(timingSafeEqual化)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertCalls.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token'
  })

  it('正しい署名の場合は200で受理される', async () => {
    const { POST } = await import('../../app/api/line/webhook/route')
    const res = await POST(buildReq(rawBody, sign(rawBody, CHANNEL_SECRET)))

    expect(res.status).toBe(200)
    expect(insertCalls.length).toBeGreaterThan(0)
  })

  it('不正な署名(長さは正しい署名と同じ)の場合は401で拒否され、DB処理は行われない', async () => {
    const wrongSignature = sign(rawBody, 'wrong-secret')
    // HMAC-SHA256のbase64は常に44文字になるため、正しい署名と同じ長さで値だけが異なるケースを再現できる
    expect(wrongSignature.length).toBe(sign(rawBody, CHANNEL_SECRET).length)

    const { POST } = await import('../../app/api/line/webhook/route')
    const res = await POST(buildReq(rawBody, wrongSignature))

    expect(res.status).toBe(401)
    expect(insertCalls).toHaveLength(0)
  })

  it('署名長が異なる不正署名の場合、例外にならず401で拒否される', async () => {
    const { POST } = await import('../../app/api/line/webhook/route')
    const res = await POST(buildReq(rawBody, 'short'))

    expect(res.status).toBe(401)
    expect(insertCalls).toHaveLength(0)
  })

  it('署名ヘッダーが空文字の場合も例外にならず401で拒否される', async () => {
    const { POST } = await import('../../app/api/line/webhook/route')
    const res = await POST(buildReq(rawBody, ''))

    expect(res.status).toBe(401)
    expect(insertCalls).toHaveLength(0)
  })

  it('LINE_CHANNEL_SECRET/ACCESS_TOKEN未設定時は従来どおり500を返す', async () => {
    delete process.env.LINE_CHANNEL_SECRET
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN

    const { POST } = await import('../../app/api/line/webhook/route')
    const res = await POST(buildReq(rawBody, sign(rawBody, CHANNEL_SECRET)))

    expect(res.status).toBe(500)
  })
})

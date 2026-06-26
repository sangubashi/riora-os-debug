import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

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
          select: () => ({
            eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }
      }
      if (table === 'line_user_ids') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: lineUserIdsRows.find((r) => r.line_user_id === val) ?? null,
                  error: null,
                }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

const CHANNEL_SECRET = 'test-secret'

function signedRequest(body: object) {
  const rawBody = JSON.stringify(body)
  const signature = createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64')
  return new Request('http://localhost/api/line/webhook', {
    method: 'POST',
    headers: { 'x-line-signature': signature, 'content-type': 'application/json' },
    body: rawBody,
  })
}

describe('POST /api/line/webhook — messageイベント', () => {
  beforeEach(() => {
    insertCalls.length = 0
    lineUserIdsRows.length = 0
    process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    vi.resetModules()
  })

  it('テキストメッセージ受信時は実際の本文をline_send_logsに保存する(固定文言ではない)', async () => {
    const { POST } = await import('../../app/api/line/webhook/route')
    const req = signedRequest({
      destination: 'dest',
      events: [
        {
          type: 'message',
          source: { type: 'user', userId: 'Uabc123' },
          timestamp: Date.now(),
          webhookEventId: 'evt-1',
          message: { id: 'm1', type: 'text', text: '予約の変更をお願いできますか' },
        },
      ],
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].message_body).toBe('予約の変更をお願いできますか')
    expect((insertCalls[0].metadata as Record<string, unknown>).direction).toBe('incoming')
    expect((insertCalls[0].metadata as Record<string, unknown>).event_type).toBe('message')
  })

  it('line_user_idsに顧客紐付けが実在する場合はmetadata.customer_idへ解決結果を入れる', async () => {
    lineUserIdsRows.push({ line_user_id: 'Uabc123', customer_id: 'cust-real-1' })
    const { POST } = await import('../../app/api/line/webhook/route')
    const req = signedRequest({
      destination: 'dest',
      events: [
        {
          type: 'message',
          source: { type: 'user', userId: 'Uabc123' },
          timestamp: Date.now(),
          webhookEventId: 'evt-2',
          message: { id: 'm2', type: 'text', text: 'ありがとうございます' },
        },
      ],
    })
    await POST(req as never)
    expect((insertCalls[0].metadata as Record<string, unknown>).customer_id).toBe('cust-real-1')
  })

  it('紐付けが無い場合はcustomer_id=nullのまま(架空のIDを補わない)', async () => {
    const { POST } = await import('../../app/api/line/webhook/route')
    const req = signedRequest({
      destination: 'dest',
      events: [
        {
          type: 'message',
          source: { type: 'user', userId: 'Uunknown' },
          timestamp: Date.now(),
          webhookEventId: 'evt-3',
          message: { id: 'm3', type: 'text', text: 'こんにちは' },
        },
      ],
    })
    await POST(req as never)
    expect((insertCalls[0].metadata as Record<string, unknown>).customer_id).toBeNull()
  })

  it('テキスト以外(スタンプ等)は本文を作文せず種別名のみ記録する', async () => {
    const { POST } = await import('../../app/api/line/webhook/route')
    const req = signedRequest({
      destination: 'dest',
      events: [
        {
          type: 'message',
          source: { type: 'user', userId: 'Uabc123' },
          timestamp: Date.now(),
          webhookEventId: 'evt-4',
          message: { id: 'm4', type: 'sticker' },
        },
      ],
    })
    await POST(req as never)
    expect(insertCalls[0].message_body).toBe('[非テキストメッセージ: sticker]')
  })
})

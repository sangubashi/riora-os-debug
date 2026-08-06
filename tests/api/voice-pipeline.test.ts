// ================================================================
// POST /api/voice-pipeline ルートレベル受入テスト
//
// 現行route.ts(JSON body: voiceNoteId/storagePath/customerId/staffId/reservationId
// 経由。VM-8のmultipart/form-data契約とは異なる、現在committed・本番稼働中の実装)
// を対象にする。SECURITY_FINAL_AUDIT H-2 対応(STAFF-PERMISSION-AUDIT-2 STEP2)の
// 回帰確認が目的:
//   - 正常系: 認可済みスタッフが担当顧客の音声メモを解析・保存できる
//   - 担当外403: canAccessCustomerがfalseを返す顧客には一切書き込まない
//   - staffId偽装拒否: body.staffIdを詐称しても、DB書き込みにはBearerトークンから
//     解決したauthUserIdが使われる(client供給値は無視される)
//
// OPENAI_API_KEY/ANTHROPIC_API_KEYはroute.tsがモジュールトップレベル定数として
// 1度だけ読むため、beforeAllで環境変数を設定してから動的importする
// (customers-homecare-message.test.tsと同じパターン)。
// ================================================================
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  voicePipelineLimiter: { limit: vi.fn().mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 }) },
}))

// ─── Supabase(createClient直呼び出し)モック ────────────────────────────────
// テーブルごとにcall順でresultを消費する汎用チェーンビルダー。insert/updateの
// 呼び出し内容はテーブル名ごとに記録し、テストから検証できるようにする。
const tableResults: Record<string, Array<{ data: unknown; error: unknown }>> = {}
const insertsByTable: Record<string, unknown> = {}
const callIndexByTable: Record<string, number> = {}
const downloadMock = vi.fn(async () => ({
  data: { arrayBuffer: async () => new ArrayBuffer(8), type: 'audio/webm' },
  error: null,
}))

function resetSupabaseMock() {
  for (const k of Object.keys(tableResults)) delete tableResults[k]
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k]
  for (const k of Object.keys(callIndexByTable)) delete callIndexByTable[k]
  downloadMock.mockClear()
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      b.select = vi.fn(chain)
      b.eq = vi.fn(chain)
      b.not = vi.fn(chain)
      b.is = vi.fn(chain)
      b.order = vi.fn(chain)
      b.limit = vi.fn(chain)
      b.update = vi.fn(chain)
      b.insert = vi.fn((rows: unknown) => { insertsByTable[table] = rows; return b })
      b.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
        const queue = tableResults[table] ?? []
        const idx = callIndexByTable[table] ?? 0
        callIndexByTable[table] = idx + 1
        const result = queue[idx] ?? { data: [], error: null }
        return Promise.resolve(result).then(resolve)
      }
      return b
    }),
    storage: { from: vi.fn(() => ({ download: downloadMock })) },
  })),
}))

let POST: typeof import('../../app/api/voice-pipeline/route').POST
beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-openai-key'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  ;({ POST } = await import('../../app/api/voice-pipeline/route'))
})

const STAFF = {
  authUserId:  'auth-uid-legit',
  staffBrainId: 'staff-brain-1',
  email:        'staff@example.com',
  isAdmin:      false,
}

const TRANSCRIPT = 'お客様は最近肌が乾燥しやすいとおっしゃっていました。'

const CLAUDE_ANALYSIS = {
  customerNotes: [{ category: 'Health', note: '肌が乾燥しやすいとのこと' }],
  bookingPrompt: {
    summary: '次回は保湿ケアを重点的にご案内',
    recommended_topics: ['保湿ケア'],
    recommended_proposals: ['化粧水の見直し'],
    risk_flags: [],
    confidence: 0.8,
  },
  handoverNotes: {
    summary: '乾燥肌の傾向あり',
    customer_context: ['乾燥しやすい'],
    open_tasks: [],
    recommended_actions: ['保湿提案'],
    risk_flags: [],
    confidence: 0.8,
  },
  contraindications: [] as unknown[],
}

const VALID_BODY = {
  voiceNoteId:   'vn-1',
  storagePath:   'auth-uid-legit/cust-1/12345.webm',
  customerId:    'cust-1',
  // なりすまし拒否の確認のため、本人(STAFF.authUserId)とは異なる値を意図的に送る。
  staffId:       'auth-uid-SPOOFED',
  reservationId: null,
}

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/voice-pipeline', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
  })
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === 'https://api.openai.com/v1/audio/transcriptions') {
      return { ok: true, text: async () => TRANSCRIPT } as Response
    }
    if (url === 'https://api.anthropic.com/v1/messages') {
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: JSON.stringify(CLAUDE_ANALYSIS) }] }),
      } as Response
    }
    throw new Error(`unexpected fetch url: ${url}`)
  }))
}

describe('POST /api/voice-pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock()
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('正常系: 認可済みスタッフが担当顧客の音声メモを解析・保存できる', async () => {
    const res = await POST(buildRequest(VALID_BODY))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.transcript).toBe(TRANSCRIPT)
    expect(body.analysis.customerNotesCount).toBe(1)
    expect(body.analysis.contraindicationsCount).toBe(0)
    expect(canAccessCustomer).toHaveBeenCalledWith(STAFF.staffBrainId, 'cust-1', STAFF.isAdmin)
  })

  it('担当外顧客の場合は403を返し、外部API・DB書き込みを一切行わない', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false)

    const res = await POST(buildRequest(VALID_BODY))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
    expect(fetch).not.toHaveBeenCalled()
    expect(downloadMock).not.toHaveBeenCalled()
    expect(insertsByTable['customer_notes']).toBeUndefined()
    expect(insertsByTable['customer_memories']).toBeUndefined()
  })

  it('body.staffIdを偽装しても、customer_notes/customer_memoriesにはトークン由来のauthUserIdが記録される(なりすまし拒否)', async () => {
    const res = await POST(buildRequest(VALID_BODY))
    expect(res.status).toBe(200)

    const notes = insertsByTable['customer_notes'] as Array<{ staff_id: string }>
    expect(notes).toBeDefined()
    expect(notes[0].staff_id).toBe(STAFF.authUserId)
    expect(notes[0].staff_id).not.toBe(VALID_BODY.staffId)

    const memories = insertsByTable['customer_memories'] as Array<{ created_by: string }>
    expect(memories).toBeDefined()
    expect(memories[0].created_by).toBe(STAFF.authUserId)
    expect(memories[0].created_by).not.toBe(VALID_BODY.staffId)
  })

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)

    const res = await POST(buildRequest(VALID_BODY))

    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
})

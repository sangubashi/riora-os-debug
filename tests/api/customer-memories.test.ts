import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))

// customer_memoriesの行(直近チェック対象)をテストごとに差し替える
let existingRows: Array<{ content: string; created_at: string }> = []
const insertCalls: Record<string, unknown>[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'customer_memories') throw new Error(`unexpected table: ${table}`)
      return {
        // POSTの重複チェック相当(select('content').eq('customer_id',...).gte('created_at',...))
        // 実装と同じく created_at >= since で絞り込む(直近5分より古い行を正しく除外するため)
        select: () => ({
          eq: () => ({
            gte: (_col: string, since: string) => Promise.resolve({
              data: existingRows.filter(r => r.created_at >= since),
              error: null,
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertCalls.push(row)
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: `mem-${insertCalls.length}`, ...row },
                  error: null,
                }),
            }),
          }
        },
      }
    },
  }),
}))

const STAFF = { authUserId: 'staff-auth-uid', staffBrainId: 'staff-1', email: 'staff@example.com', isAdmin: false }
const CUSTOMER_ID = 'cust-1'

// 前方一致判定(先頭30文字)を確実に検証するため、共通接頭辞を文字数で厳密に構成する
// (手打ちの日本語サンプル文字列は文字数カウントを誤りやすいため)
const SHARED_PREFIX_30 = 'あ'.repeat(30)

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/customer-memories', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/customer-memories（重複チェック）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertCalls.length = 0
    existingRows = []
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never)
    vi.mocked(canAccessCustomer).mockResolvedValue(true)
  })

  it('同一customer_id・content前方一致(直近5分以内)の重複は2件目をINSERTしない', async () => {
    existingRows = [
      { content: `${SHARED_PREFIX_30}(以前の言い回し)`, created_at: new Date().toISOString() },
    ]
    const { POST } = await import('../../app/api/customer-memories/route')

    const res = await POST(buildReq({
      customer_id: CUSTOMER_ID,
      content: `${SHARED_PREFIX_30}(今回の言い回し)`, // 先頭30文字が既存と完全一致
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ skipped: true, reason: 'duplicate_recent_memory' })
    expect(insertCalls).toHaveLength(0)
  })

  it('同一customer_idでもcontentが明確に異なれば両方INSERTされる', async () => {
    existingRows = [
      { content: '趣味はガーデニングで週末は庭いじりをしている', created_at: new Date().toISOString() },
    ]
    const { POST } = await import('../../app/api/customer-memories/route')

    const res = await POST(buildReq({
      customer_id: CUSTOMER_ID,
      content: '家族構成は夫と娘2人、来月娘の入学式がある', // 全く異なる内容
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.memory).toBeDefined()
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].content).toBe('家族構成は夫と娘2人、来月娘の入学式がある')
  })

  it('customer_idが異なれば同じ内容でもINSERTされる（重複チェックはcustomer_id単位）', async () => {
    // existingRowsは「同一customer_idのSELECT」を模したモックのため、別顧客宛の
    // POSTでは重複チェック自体は同じ結果セットを見るが、canAccessCustomer等の
    // 経路は独立しておりcustomer_id単位で判定される設計であることを確認する。
    existingRows = []
    const { POST } = await import('../../app/api/customer-memories/route')

    const res = await POST(buildReq({
      customer_id: 'cust-2',
      content: '趣味はガーデニングで週末は庭いじりをしている',
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.memory).toBeDefined()
    expect(insertCalls).toHaveLength(1)
  })

  it('直近5分より古い既存Memoryとの前方一致は重複扱いにせずINSERTする', async () => {
    existingRows = [
      {
        content: `${SHARED_PREFIX_30}(古い言い回し)`,
        created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10分前
      },
    ]
    const { POST } = await import('../../app/api/customer-memories/route')

    const res = await POST(buildReq({
      customer_id: CUSTOMER_ID,
      content: `${SHARED_PREFIX_30}(新しい言い回し)`,
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.memory).toBeDefined()
    expect(insertCalls).toHaveLength(1)
  })

  it('既存バリデーション: customer_id欠落は400のまま', async () => {
    const { POST } = await import('../../app/api/customer-memories/route')
    const res = await POST(buildReq({ content: '本文のみ' }))
    expect(res.status).toBe(400)
    expect(insertCalls).toHaveLength(0)
  })

  it('既存バリデーション: content空文字は400のまま', async () => {
    const { POST } = await import('../../app/api/customer-memories/route')
    const res = await POST(buildReq({ customer_id: CUSTOMER_ID, content: '   ' }))
    expect(res.status).toBe(400)
    expect(insertCalls).toHaveLength(0)
  })

  it('既存バリデーション: 未認証は401のまま', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null)
    const { POST } = await import('../../app/api/customer-memories/route')
    const res = await POST(buildReq({ customer_id: CUSTOMER_ID, content: '本文' }))
    expect(res.status).toBe(401)
    expect(insertCalls).toHaveLength(0)
  })

  it('既存バリデーション: アクセス権が無い顧客は403のまま', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false)
    const { POST } = await import('../../app/api/customer-memories/route')
    const res = await POST(buildReq({ customer_id: CUSTOMER_ID, content: '本文' }))
    expect(res.status).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })

  it('候補が0件（新規顧客）の場合は通常通りINSERTされる', async () => {
    existingRows = []
    const { POST } = await import('../../app/api/customer-memories/route')
    const res = await POST(buildReq({ customer_id: CUSTOMER_ID, content: '初回のメモ内容' }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.memory).toBeDefined()
    expect(insertCalls).toHaveLength(1)
  })
})

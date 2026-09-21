// ================================================================
// linkFacialSchemasToVisit.ts — 顔シェーマ「未紐付けデータ→visit自動紐付け」(Phase 7)
//
// tests/lib/photos/linkPhotosToVisit.test.tsと同じ観点で検証する。写真機能との違いは
// schema_dateが既にJST暦日の'date'型のため、taken_atのようなUTC範囲変換が不要で
// 直接等価比較になる点(ケース6相当のJST変換テストはそのため不要)。
// ================================================================
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/facialSchema/facialSchemaDb', () => ({
  getFacialSchemaServiceClient: vi.fn(),
}))

import { getFacialSchemaServiceClient } from '../../../src/lib/facialSchema/facialSchemaDb'
import { linkDraftFacialSchemaToVisit } from '../../../src/lib/facialSchema/linkFacialSchemasToVisit'

const mockGetClient = vi.mocked(getFacialSchemaServiceClient)

/** update().eq().is().is().eq().select() のチェインを記録しつつ結果を返すフェイク。 */
function createFakeSupabase(result: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = []
  const chainMethods = ['update', 'eq', 'is', 'select'] as const

  function chainable(): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    for (const m of chainMethods) {
      obj[m] = vi.fn((...args: unknown[]) => {
        calls.push({ method: m, args })
        return obj
      })
    }
    obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return obj
  }

  return {
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] })
      return chainable()
    }),
    __calls: calls,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('linkDraftFacialSchemaToVisit', () => {
  it('正しいWHERE条件(customer_id/visit_id IS NULL/deleted_at IS NULL/schema_date一致)でUPDATEを組み立てる', async () => {
    const fake = createFakeSupabase({ data: [{ id: 'schema-1' }], error: null })
    mockGetClient.mockReturnValue(fake as never)

    const result = await linkDraftFacialSchemaToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-21',
    })

    expect(result).toEqual({ ok: true, linkedCount: 1 })
    expect(fake.from).toHaveBeenCalledWith('brain_customer_facial_schemas')

    const calls = fake.__calls
    expect(calls).toContainEqual({ method: 'update', args: [{ visit_id: 'visit-1' }] })
    expect(calls).toContainEqual({ method: 'eq', args: ['customer_id', 'cust-1'] })
    expect(calls).toContainEqual({ method: 'is', args: ['visit_id', null] })
    expect(calls).toContainEqual({ method: 'is', args: ['deleted_at', null] })
    expect(calls).toContainEqual({ method: 'eq', args: ['schema_date', '2026-09-21'] })
  })

  it('該当行が無い(未紐付けの記録が存在しない)場合はlinkedCount:0を返す', async () => {
    const fake = createFakeSupabase({ data: [], error: null })
    mockGetClient.mockReturnValue(fake as never)

    const result = await linkDraftFacialSchemaToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-21',
    })

    expect(result).toEqual({ ok: true, linkedCount: 0 })
  })

  it('UPDATEがSupabaseエラー(部分ユニークインデックス違反等)を返しても例外を投げずok:falseで返す', async () => {
    const fake = createFakeSupabase({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    mockGetClient.mockReturnValue(fake as never)

    const result = await linkDraftFacialSchemaToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-21',
    })

    expect(result).toEqual({ ok: false, error: 'duplicate key value violates unique constraint' })
  })

  it('getFacialSchemaServiceClient自体が例外を投げても(env未設定等)呼び出し元へ例外を伝播させない', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('Supabase env not configured')
    })

    const result = await linkDraftFacialSchemaToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-21',
    })

    expect(result).toEqual({ ok: false, error: 'Supabase env not configured' })
  })
})

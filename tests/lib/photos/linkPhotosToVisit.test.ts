// ================================================================
// linkPhotosToVisit.ts — 写真カルテ「写真→visit自動紐付け」Phase 1
//
// 対応ケース(ユーザー指定):
//   1. customer一致・visit_id NULL・taken_at=JST当日・deleted_at NULL → 紐付け対象になる
//   2. taken_at=JST前日 → 対象外(rangeの外)
//   3. 既存visit_idありの写真 → is('visit_id', null)条件でそもそも対象外
//   4. deleted_atあり → is('deleted_at', null)条件でそもそも対象外
//   5. UPDATE自体が失敗 → 例外を投げずok:falseを返す(呼び出し元を落とさない)
//   6. JSTの日付境界 → UTC日付ではなくJST日付で計算されていることを直接検証
// ================================================================
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/photos/photoDb', () => ({
  getPhotoServiceClient: vi.fn(),
}))

import { getPhotoServiceClient } from '../../../src/lib/photos/photoDb'
import { jstDayRangeToUtcIso, linkUnattachedPhotosToVisit } from '../../../src/lib/photos/linkPhotosToVisit'

const mockGetClient = vi.mocked(getPhotoServiceClient)

/** update().eq().is().is().gte().lt().select() のチェインを記録しつつ結果を返すフェイク。 */
function createFakeSupabase(result: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = []
  const chainMethods = ['update', 'eq', 'is', 'gte', 'lt', 'select'] as const

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

describe('jstDayRangeToUtcIso（ケース6: JST日付境界）', () => {
  it('JST暦日の00:00〜24:00を正しくUTC範囲に変換する(UTC日付そのままではない)', () => {
    // 2026-09-08(JST) 00:00 は UTC では 2026-09-07 15:00
    const { startUtc, endUtc } = jstDayRangeToUtcIso('2026-09-08')
    expect(startUtc).toBe('2026-09-07T15:00:00.000Z')
    expect(endUtc).toBe('2026-09-08T15:00:00.000Z')
  })

  it('UTC日付として単純比較していたら失敗するはずの境界値(JST 09:00=UTC 00:00)を正しく範囲内と判定できる', () => {
    // JST 2026-09-08 09:00 = UTC 2026-09-08 00:00。
    // もしUTC日付のみで比較していたら taken_at の"UTC日付"は2026-09-08になり、
    // 誤って"当日"のつもりが実際は正しく一致するケース(区別が付きにくい罠)。
    // 逆に JST 2026-09-08 08:59 = UTC 2026-09-07 23:59 は、UTC日付だと前日(09-07)に
    // 見えてしまうが、JST基準では正しく2026-09-08の範囲に含まれる必要がある。
    const { startUtc, endUtc } = jstDayRangeToUtcIso('2026-09-08')
    const earlyMorningJstUtc = '2026-09-07T23:59:00.000Z' // JST 2026-09-08 08:59
    expect(earlyMorningJstUtc >= startUtc).toBe(true)
    expect(earlyMorningJstUtc < endUtc).toBe(true)
  })
})

describe('linkUnattachedPhotosToVisit', () => {
  it('ケース1: 正しいWHERE条件(customer_id/visit_id IS NULL/deleted_at IS NULL/taken_at範囲)でUPDATEを組み立てる', async () => {
    const fake = createFakeSupabase({ data: [{ id: 'photo-1' }], error: null })
    mockGetClient.mockReturnValue(fake as never)

    const result = await linkUnattachedPhotosToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-08',
    })

    expect(result).toEqual({ ok: true, linkedCount: 1 })
    expect(fake.from).toHaveBeenCalledWith('brain_customer_photos')

    const calls = fake.__calls
    expect(calls).toContainEqual({ method: 'update', args: [{ visit_id: 'visit-1' }] })
    expect(calls).toContainEqual({ method: 'eq', args: ['customer_id', 'cust-1'] })
    expect(calls).toContainEqual({ method: 'is', args: ['visit_id', null] })
    expect(calls).toContainEqual({ method: 'is', args: ['deleted_at', null] })
    expect(calls).toContainEqual({ method: 'gte', args: ['taken_at', '2026-09-07T15:00:00.000Z'] })
    expect(calls).toContainEqual({ method: 'lt', args: ['taken_at', '2026-09-08T15:00:00.000Z'] })
  })

  it('ケース2/3/4は呼び出し側のフィルタ条件でDB側が対象外にする前提のため、0件更新時は linkedCount:0 を返す', async () => {
    // (前日撮影/既存visit_idあり/論理削除済みのいずれも、上記WHERE条件により
    //  実DBでは行がヒットしない。ここではSupabaseからdata:[]が返るケースとして検証する)
    const fake = createFakeSupabase({ data: [], error: null })
    mockGetClient.mockReturnValue(fake as never)

    const result = await linkUnattachedPhotosToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-08',
    })

    expect(result).toEqual({ ok: true, linkedCount: 0 })
  })

  it('ケース5: UPDATEがSupabaseエラーを返しても例外を投げずok:falseで返す', async () => {
    const fake = createFakeSupabase({ data: null, error: { message: 'db down' } })
    mockGetClient.mockReturnValue(fake as never)

    const result = await linkUnattachedPhotosToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-08',
    })

    expect(result).toEqual({ ok: false, error: 'db down' })
  })

  it('ケース5: getPhotoServiceClient自体が例外を投げても(env未設定等)呼び出し元へ例外を伝播させない', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('Supabase env not configured')
    })

    const result = await linkUnattachedPhotosToVisit({
      customerId: 'cust-1',
      visitId:    'visit-1',
      visitDate:  '2026-09-08',
    })

    expect(result).toEqual({ ok: false, error: 'Supabase env not configured' })
  })
})

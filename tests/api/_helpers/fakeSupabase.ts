// ================================================================
// デジタル顧客カルテ Phase1-A の新規APIテスト共通ヘルパー。
//
// tests/api/customer-photos-list.test.ts の createFakeSupabase() と同趣旨だが、
// insert/update/single/maybeSingleも含む(select専用の既存版を汎用化)。
// テーブルごとに結果をキュー(配列)で持ち、同じテーブルへの複数回のfrom()呼び出しに
// 順番に応答できるようにする(例: skin-records POSTの「既存行検索→insert」の2段階)。
// ================================================================
import { vi } from 'vitest'

export interface FakeResult {
  data?:  unknown
  error?: unknown
}

const CHAIN_METHODS = [
  'select', 'eq', 'is', 'order', 'limit', 'lt', 'gt', 'in', 'gte', 'lte', 'neq',
  'insert', 'update', 'single', 'maybeSingle',
] as const

function chainable(result: FakeResult) {
  const obj: Record<string, unknown> = {}
  for (const m of CHAIN_METHODS) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

/**
 * table名 → 結果(単発 or キュー)のマップからフェイクSupabaseクライアントを作る。
 * 同じtableに複数回from()する場合はキュー(配列)を渡すと呼び出し順に消費される
 * (最後の要素に達したらそれ以降も同じ結果を返し続ける)。
 */
export function createFakeSupabase(
  resultsByTable: Record<string, FakeResult | FakeResult[]>
) {
  const callIndex: Record<string, number> = {}

  const from = vi.fn((table: string) => {
    const configured = resultsByTable[table] ?? { data: null, error: null }
    const queue = Array.isArray(configured) ? configured : [configured]
    const idx = callIndex[table] ?? 0
    callIndex[table] = idx + 1
    const result = queue[Math.min(idx, queue.length - 1)]
    return chainable(result)
  })

  /** table名に対応する、n回目(0始まり)のfrom()呼び出しが返したチェイン可能オブジェクトを取得する */
  function chainFor(table: string, callN = 0) {
    const calls = from.mock.calls
      .map((call, i) => ({ call, i }))
      .filter(({ call }) => call[0] === table)
    const target = calls[callN]
    if (!target) throw new Error(`from('${table}') was not called (callN=${callN})`)
    return from.mock.results[target.i]!.value as Record<string, ReturnType<typeof vi.fn>>
  }

  return { from, chainFor }
}

// ================================================================
// Repository & RPC Layer: SupabaseClientモックヘルパー
//
// PostgrestFilterBuilder相当のチェーン可能メソッド(select/eq/in/or/
// order/limit/is/insert/update/delete)は全てbuilder自身を返し、
// 最終的にawaitされた時点でthen()がMockResultをそのまま解決する。
// maybeSingle()/single()はPromise<MockResult>を直接返す。
// ================================================================

import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MockResult<T = unknown> {
  data: T;
  error: { message: string } | null;
  count?: number | null;
}

const CHAIN_METHODS = ['select', 'eq', 'in', 'or', 'order', 'limit', 'is', 'insert', 'update', 'upsert', 'delete', 'gte', 'lte'] as const;

export function createQueryBuilderMock(result: MockResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = vi.fn(() => builder);

  for (const method of CHAIN_METHODS) {
    builder[method] = chain;
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (onfulfilled?: (value: MockResult) => unknown, onrejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onfulfilled, onrejected);

  return builder;
}

export function createSupabaseMock(fromImpl: (table: string) => Record<string, unknown>): SupabaseClient {
  return { from: vi.fn(fromImpl) } as unknown as SupabaseClient;
}

/** 単一テーブルのみ参照するRepo向け: 常に同じbuilderを返すSupabaseClientモック。 */
export function createSingleTableSupabaseMock(result: MockResult): {
  client: SupabaseClient;
  builder: Record<string, unknown>;
} {
  const builder = createQueryBuilderMock(result);
  return { client: createSupabaseMock(() => builder), builder };
}

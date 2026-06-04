'use client'
/**
 * useStoreLearnings.ts  — React Query 版
 *
 * store_patterns を React Query でキャッシュし、
 * getStoreLearnings で接客知見を生成するカスタムフック。
 *
 * 設計:
 *   - queryKey: ['store_patterns', sortedTags] でタグ単位にキャッシュ
 *   - staleTime: 5分（接客中に不要な refetch をしない）
 *   - placeholderData: keepPreviousData で顧客切り替え時にちらつかない
 *   - loading/error は silent（UI に出さない。接客テンポを崩さない）
 *   - enabled: セッションがある場合のみ実行
 */

import { useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useAuthStore } from '@/store/useAuthStore'
import { fetchStorePatternsForCustomer } from '@/lib/storeLearningRepository'
import { getStoreLearnings } from '@/lib/storeLearning'
import type { StoreLearning } from '@/types/storeLearning'

// ─── Query Key ────────────────────────────────────────────────────────────────

/** タグをソートして安定したキャッシュキーを生成 */
function makeQueryKey(customerTags: string[]) {
  return ['store_patterns', [...customerTags].sort()] as const
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseStoreLearningsReturn {
  learnings:  StoreLearning[]
  isLoading:  boolean   // 初回フェッチ中（silent なので基本使わない）
  isFetching: boolean   // バックグラウンド更新中
}

export function useStoreLearnings(
  customerTags: string[],
  servicePhase: string,
  limit = 2
): UseStoreLearningsReturn {
  const { session, initialized } = useAuthStore()

  const enabled = initialized && !!session && customerTags.length > 0

  const { data: rawPatterns = [], isLoading, isFetching } = useQuery({
    queryKey:        makeQueryKey(customerTags),
    queryFn:         () => fetchStorePatternsForCustomer({ customerTags, limit: 50 }),
    enabled,
    staleTime:       5  * 60 * 1000,   // 5分
    gcTime:          10 * 60 * 1000,   // 10分
    retry:           1,
    placeholderData: keepPreviousData,  // 顧客切り替え時に空白なし
    refetchOnWindowFocus: false,
    refetchOnReconnect:   true,
  })

  // 知見生成は rawPatterns / customerTags / servicePhase 変化時のみ再計算
  const learnings = useMemo(
    () => getStoreLearnings(rawPatterns, customerTags, servicePhase, limit),
    [rawPatterns, customerTags, servicePhase, limit]
  )

  return { learnings, isLoading, isFetching }
}

// ─── キャッシュ操作（デモリセット・テスト用） ─────────────────────────────────
// React Query の queryClient から直接操作が必要な場合は
// useQueryClient() を使ってください:
//
//   const qc = useQueryClient()
//   qc.invalidateQueries({ queryKey: ['store_patterns'] })
//   qc.removeQueries({ queryKey: ['store_patterns'] })

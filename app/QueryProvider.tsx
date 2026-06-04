'use client'
/**
 * QueryProvider.tsx
 * @tanstack/react-query の QueryClient を全体に提供。
 * layout.tsx から ClientShell と並列で使用。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

export default function QueryProvider({ children }: { children: ReactNode }) {
  // コンポーネントごとに QueryClient インスタンスを生成（SSR safe）
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // グローバルデフォルト
        staleTime:            5  * 60 * 1000,   // 5分
        gcTime:               10 * 60 * 1000,   // 10分
        retry:                1,
        refetchOnWindowFocus: false,             // 接客中の意図しない refetch を防止
        refetchOnReconnect:   true,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

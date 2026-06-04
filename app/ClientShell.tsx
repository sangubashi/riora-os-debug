'use client'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { prodLog } from '@/lib/stability'

/**
 * アプリ起動時に AuthStore を初期化し、Supabase セッションをストアへ反映する。
 * PHASE7: グローバル unhandledRejection / error をキャッチして prodLog に記録。
 */
export default function ClientShell({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore(s => s.initialize)

  useEffect(() => {
    initialize()

    // PHASE7: グローバルエラーキャッチ（接客中に白画面にしない）
    const onUnhandled = (e: PromiseRejectionEvent) => {
      prodLog('error', '[Global] unhandledRejection', e.reason)
    }
    const onError = (e: ErrorEvent) => {
      prodLog('error', '[Global] error', { message: e.message, filename: e.filename })
    }

    window.addEventListener('unhandledrejection', onUnhandled)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled)
      window.removeEventListener('error', onError)
    }
  }, [initialize])

  return <>{children}</>
}

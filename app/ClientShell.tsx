'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { useStaffStore } from '@/store/useStaffStore'
import { prodLog } from '@/lib/stability'

// 認証不要なパス(本当に公開してよい画面のみ。DEMO_MODEの値に関わらず常にこのリストで判定する)。
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/splash',
  '/test',
]

/**
 * アプリ起動時に AuthStore を初期化し、Supabase セッションをストアへ反映する。
 * PHASE7: グローバル unhandledRejection / error をキャッチして prodLog に記録。
 *
 * 認証ガード(未ログインなら/loginへリダイレクト)はDEMO_MODEの値に関わらず常に有効。
 * DEMO_MODE時の自動サインインはuseAuthStore.attemptDemoAutoSignIn()に集約されており、
 * 本コンポーネントはDEMO_MODEを直接参照しない(認証基盤とDEMO_MODEの分離)。
 */
export default function ClientShell({ children }: { children: React.ReactNode }) {
  const initialize              = useAuthStore(s => s.initialize)
  const session                 = useAuthStore(s => s.session)
  const initialized             = useAuthStore(s => s.initialized)
  const attemptDemoAutoSignIn   = useAuthStore(s => s.attemptDemoAutoSignIn)
  const router      = useRouter()
  const pathname    = usePathname()

  useEffect(() => {
    initialize()

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

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

  // session.user.id → useStaffStore.currentStaffId へ同期
  useEffect(() => {
    const uid = session?.user?.id
    if (uid) {
      useStaffStore.getState().setCurrentStaffId(uid)
    }
  }, [session])

  // DEMO_MODE時のみ実行される(本番ではno-op)。判定はuseAuthStore側に集約済み。
  useEffect(() => {
    if (!initialized) return
    if (session) return
    attemptDemoAutoSignIn()
  }, [initialized, session, attemptDemoAutoSignIn])

  // 認証確認完了後、未ログインなら /login へリダイレクト(DEMO_MODEの値に関わらず常に有効)
  useEffect(() => {
    if (!initialized) return

    const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (!session && !isPublic) {
      console.log('[AUTH]', { pathname, initialized, hasSession: !!session })
      router.replace('/login')
    }
  }, [initialized, session, pathname, router])

  // 認証確認中はローディング表示（公開パスはそのまま表示）
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!initialized && !isPublic) {
    return (
      <div
        style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FFF8F7',
          fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
        }}
      >
        <p style={{ fontSize: '12px', color: '#9F7E6C', letterSpacing: '0.1em' }}>
          読み込み中…
        </p>
      </div>
    )
  }

  return <>{children}</>
}

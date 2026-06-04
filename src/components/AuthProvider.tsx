'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { DEMO_MODE } from '@/lib/supabase'

// 認証不要なパス（DEMO_MODE 時は全パスがここに該当する扱い）
const PUBLIC_PATHS = [
  '/login',
  '/splash',
  '/test',
  '/phase1-debug',
  '/phase1',
  '/customers',
  '/kpi',
  '/line',
  '/menu',
  '/ai-suggestions',
]

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { initialize, session, initialized } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()

  // アプリ起動時に1回だけセッション確認
  useEffect(() => {
    initialize()
  }, [initialize])

  // 認証確認完了後、未ログインなら /login へリダイレクト
  useEffect(() => {
    if (!initialized) return

    // DEMO_MODE: 認証チェックを完全スキップ（この return より下には到達しない）
    if (DEMO_MODE) return

    const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (!session && !isPublic) {
      console.log('[AUTH]', {
        pathname,
        initialized,
        hasSession: !!session,
        DEMO_MODE,
      })
      router.replace('/login')
    }
  }, [initialized, session, pathname, router])

  // 認証確認中はローディング表示（DEMO_MODE・公開パスはそのまま表示）
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!DEMO_MODE && !initialized && !isPublic) {
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

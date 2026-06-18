'use client'
import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { DEMO_MODE } from '@/lib/supabase'

// DEMO_MODE 時に自動サインインするテストユーザー
// 本番運用時は DEMO_MODE=false にすること（このクレデンシャルは使われなくなる）
const DEMO_CREDENTIALS = {
  email:    'admin@salon-riora.jp',
  password: 'riora2026',
} as const

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
  const { initialize, signIn, session, initialized } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  // DEMO 自動サインインの二重実行を防ぐフラグ
  const demoSignInAttempted = useRef(false)

  // アプリ起動時に1回だけセッション確認
  useEffect(() => {
    initialize()
  }, [initialize])

  // DEMO_MODE: セッションがなければテストユーザーで自動サインイン
  // → 本物の JWT セッションを取得することで RLS の TO authenticated を通過させる
  useEffect(() => {
    if (!DEMO_MODE) return
    if (!initialized) return
    if (session) return
    if (demoSignInAttempted.current) return
    demoSignInAttempted.current = true

    signIn(DEMO_CREDENTIALS).then(({ success, error }) => {
      if (!success) {
        console.warn('[DEMO] 自動サインイン失敗:', error,
          '— admin@salon-riora.jp が Supabase Auth に登録されているか確認してください')
      }
    })
  }, [initialized, session, signIn])

  // 認証確認完了後、未ログインなら /login へリダイレクト
  useEffect(() => {
    if (!initialized) return

    // DEMO_MODE: /login へ飛ばさない
    if (DEMO_MODE) return

    const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (!session && !isPublic) {
      console.log('[AUTH]', { pathname, initialized, hasSession: !!session, DEMO_MODE })
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

'use client'
/**
 * AdminAuthGuard — /admin/** の画面レベル認証ガード。
 * requireAdmin(API側)とは別に、管理者ダッシュボードの「見た目」自体を
 * 管理者本人(admin@salon-riora.jp)以外に一切表示しないようにする。
 * 参照: docs/ADMIN_AUTH_FIX_REPORT.md
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'

const ADMIN_EMAIL = 'admin@salon-riora.jp'

function GateScreen() {
  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#EDE0E4',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      <p style={{ fontSize: '12px', color: '#9F7E6C', letterSpacing: '0.1em' }}>
        読み込み中…
      </p>
    </div>
  )
}

export default function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router      = useRouter()
  const session     = useAuthStore(s => s.session)
  const initialized = useAuthStore(s => s.initialized)

  const isAdmin = session?.user?.email === ADMIN_EMAIL

  useEffect(() => {
    if (!initialized) return
    if (!session) {
      router.replace('/login')
      return
    }
    if (!isAdmin) {
      router.replace('/phase1')
    }
  }, [initialized, session, isAdmin, router])

  // 判定が終わり、かつ管理者本人であることが確定するまでは
  // 管理画面(サイドバー含む)を一切描画しない
  if (!initialized || !session || !isAdmin) {
    return <GateScreen />
  }

  return <>{children}</>
}

'use client'
/**
 * LogoutConfirmModal.tsx — ログアウト確認ダイアログ(スタッフアプリ・管理者画面 共通)
 *
 * 「ログアウトしますか？」の確認ダイアログ本体と、実行ロジック(useLogoutFlow)を
 * 共通化する。押した瞬間にログアウトしない(誤タップ事故防止のため必ず確認を挟む)。
 * ボタンの見た目(トリガー)は呼び出し側の画面デザインに合わせて個別に実装してよい。
 */
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'

/**
 * signOut() → /login遷移までを担う共通フック。
 * signOut()自体はuseAuthStore内でtry/finallyのみのため、Supabase側のエラーで
 * 画面が固まらないよう、遷移はcatch有無に関わらず必ず実行する。
 */
export function useLogoutFlow() {
  const router = useRouter()
  const { signOut } = useAuthStore()
  const [confirming,   setConfirming]   = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const openConfirm  = useCallback(() => setConfirming(true), [])
  const closeConfirm = useCallback(() => setConfirming(false), [])

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await supabaseSignOut(signOut)
    } finally {
      setIsLoggingOut(false)
      setConfirming(false)
      router.replace('/login')
    }
  }, [signOut, router])

  return { confirming, isLoggingOut, openConfirm, closeConfirm, handleLogout }
}

async function supabaseSignOut(signOut: () => Promise<void>) {
  try {
    await signOut()
  } catch {
    // ネットワークエラー等でも、ローカルセッションはsignOut()内でクリアされるため
    // ログイン画面への遷移は継続する
  }
}

export function LogoutConfirmModal({
  isLoggingOut, onConfirm, onCancel,
}: {
  isLoggingOut: boolean
  onConfirm:    () => void
  onCancel:     () => void
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(92,64,51,0.35)', padding: '16px',
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: '20px', padding: '22px 20px',
          width: '100%', maxWidth: '340px',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <div>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#4A2C2A', marginBottom: '6px' }}>
            ログアウトしますか？
          </p>
          <p style={{ fontSize: '12px', color: '#9E8090', lineHeight: 1.6 }}>
            ログアウトすると、再度ログインするまでご利用いただけません。
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onCancel}
            disabled={isLoggingOut}
            style={{
              flex: 1, fontSize: '13px', fontWeight: 600, padding: '11px',
              borderRadius: '999px', border: '1px solid #F0E4E8',
              background: '#fff', color: '#9E8090', cursor: 'pointer',
            }}
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoggingOut}
            style={{
              flex: 1, fontSize: '13px', fontWeight: 700, padding: '11px',
              borderRadius: '999px', border: 'none',
              background: '#D14F4F', color: '#fff', cursor: 'pointer',
            }}
          >
            {isLoggingOut ? 'ログアウト中…' : 'ログアウト'}
          </button>
        </div>
      </div>
    </div>
  )
}

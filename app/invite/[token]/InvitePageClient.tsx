'use client'
/**
 * InvitePageClient.tsx — /invite/[token] の実処理(STAFF_MANAGEMENT_PHASE2_2)
 *
 * フロー: ①トークン検証(GET) → ②有効ならパスワード設定フォーム表示 →
 * ③送信(POST /complete) → ④成功画面 → ⑤ログイン画面へ導線。
 * 認証不要ページのためauthedFetchは使わず素のfetchを使う。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

type InviteStatus = 'loading' | 'valid' | 'expired' | 'used' | 'not_found' | 'load_error'

interface InviteInfo {
  staffName: string
  email: string
  role: 'staff' | 'owner'
}

export default function InvitePageClient({ token }: { token: string }) {
  const [status, setStatus] = useState<InviteStatus>('loading')
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}`)
        const body = await res.json()
        if (cancelled) return

        if (!res.ok || !body.success) {
          setStatus(res.status === 404 ? 'not_found' : 'load_error')
          return
        }
        setInvite({ staffName: body.staffName, email: body.email, role: body.role })
        setStatus(body.status as InviteStatus)
      } catch {
        if (!cancelled) setStatus('load_error')
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (password.length < 8) {
      setSubmitError('パスワードは8文字以上で入力してください')
      return
    }
    if (password !== passwordConfirm) {
      setSubmitError('パスワードが一致しません')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setSubmitError(body.error ?? '登録に失敗しました')
        setSubmitting(false)
        return
      }
      setCompleted(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '登録に失敗しました')
      setSubmitting(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Salon Riora スタッフ登録</h1>

        {status === 'loading' && <p style={s.message}>招待の確認中...</p>}

        {status === 'not_found' && (
          <p style={s.errorMessage}>この招待リンクは存在しません。管理者に招待の再発行を依頼してください。</p>
        )}
        {status === 'load_error' && (
          <p style={s.errorMessage}>招待の確認に失敗しました。時間をおいて再度お試しください。</p>
        )}
        {status === 'expired' && (
          <p style={s.errorMessage}>この招待リンクの有効期限が切れています。管理者に招待の再発行を依頼してください。</p>
        )}
        {status === 'used' && (
          <p style={s.errorMessage}>この招待リンクは既に使用済みです。ログイン画面からログインしてください。</p>
        )}

        {status === 'valid' && invite && !completed && (
          <>
            <p style={s.message}>
              {invite.staffName} 様<br />
              メールアドレス: {invite.email}
            </p>
            <form onSubmit={handleSubmit}>
              <div style={s.fieldWrap}>
                <label style={s.label}>パスワード(8文字以上)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={submitting}
                  style={s.input}
                />
              </div>
              <div style={s.fieldWrap}>
                <label style={s.label}>パスワード(確認)</label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  required
                  disabled={submitting}
                  style={s.input}
                />
              </div>
              {submitError && <p style={s.errorMessage}>{submitError}</p>}
              <button type="submit" disabled={submitting} style={{ ...s.button, opacity: submitting ? 0.65 : 1 }}>
                {submitting ? '登録中...' : '登録する'}
              </button>
            </form>
          </>
        )}

        {completed && (
          <>
            <p style={s.message}>登録が完了しました。ログイン画面からログインしてください。</p>
            <Link href="/login" style={s.button as React.CSSProperties}>ログイン画面へ</Link>
          </>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    background: '#fdf3f2',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Noto Sans JP', sans-serif",
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#fff',
    borderRadius: '20px',
    padding: '32px 24px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.06)',
  },
  title: { fontSize: '18px', fontWeight: 700, color: '#5C4033', marginBottom: '16px', textAlign: 'center' },
  message: { fontSize: '13px', color: '#6b4a3d', lineHeight: 1.6, marginBottom: '16px' },
  errorMessage: { fontSize: '13px', color: '#D14F4F', lineHeight: 1.6, marginBottom: '16px' },
  fieldWrap: { marginBottom: '16px' },
  label: { fontSize: '12px', fontWeight: 600, color: '#6b4a3d', marginBottom: '6px', display: 'block' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#fdf8f7',
    border: '1px solid #f2e4df',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '14px',
    color: '#6b4a3d',
    outline: 'none',
  },
  button: {
    display: 'block',
    width: '100%',
    textAlign: 'center',
    background: '#D98292',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '14px',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    textDecoration: 'none',
    boxSizing: 'border-box',
  },
}

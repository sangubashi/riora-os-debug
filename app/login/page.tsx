'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'

interface DebugInfo {
  uid:        string | null
  email:      string | null
  role:       string | null
  hasSession: boolean
}

export default function LoginPage() {
  const router  = useRouter()
  const signIn  = useAuthStore(s => s.signIn)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [debug,    setDebug]    = useState<DebugInfo>({
    uid: null, email: null, role: null, hasSession: false,
  })

  const didRun = useRef(false)

  // ── 起動時セッション確認 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (didRun.current) return
    didRun.current = true

    ;(async () => {
      try {
        // Safari ITP 対策: 3秒タイムアウト
        const sessionP = supabase.auth.getSession()
          .then(({ data }) => data.session)
          .catch(() => null)
        const timeoutP = new Promise<null>(r => setTimeout(() => r(null), 3000))

        const session = await Promise.race([sessionP, timeoutP])

        console.log('[Login] getSession:', session
          ? `uid=${session.user.id}`
          : 'null (未ログイン or timeout)')

        if (session) {
          setDebug({
            uid:        session.user.id,
            email:      session.user.email ?? null,
            role:       (session.user.user_metadata?.role as string | undefined) ?? session.user.role ?? null,
            hasSession: true,
          })
          router.replace('/phase1')
          return
        }

        setLoading(false)
      } catch (e) {
        console.error('[Login] getSession エラー:', e)
        setLoading(false)
      }
    })()

    return () => { didRun.current = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── ログイン処理 ─────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // AuthStore 経由でログイン（ストアの session / initialized を正しく更新）
    const result = await signIn({ email: email.trim(), password })

    if (!result.success) {
      console.warn('[Login] signIn 失敗:', result.error)
      setError(result.error ?? 'ログインに失敗しました')
      setLoading(false)
      return
    }

    // ログイン成功後にセッション確認
    const { data } = await supabase.auth.getSession()
    const session  = data.session
    console.log('[Login] ログイン成功 getSession:', session
      ? `uid=${session.user.id}`
      : 'null (異常)')

    if (session) {
      setDebug({
        uid:        session.user.id,
        email:      session.user.email ?? null,
        role:       (session.user.user_metadata?.role as string | undefined) ?? session.user.role ?? null,
        hasSession: true,
      })
    }

    router.push('/phase1')
  }

  // ── ローディング ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.loadingWrap}>
        <div style={s.loadingDot} />
      </div>
    )
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* Riora Character */}
        <div style={s.charWrap}>
          <Image
            src="/riora-os/rio-kuma.png"
            alt="Riora Character"
            width={180}
            height={180}
            priority
            style={{ objectFit: 'contain', filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.06))' }}
          />
        </div>

        {/* Logo */}
        <h1 style={s.brandTitle}>Salon Riora</h1>
        <p  style={s.brandSub}>GINZA SKIN LABO</p>

        {/* Login Card */}
        <div style={s.card}>
          <form onSubmit={handleLogin}>

            {/* Email */}
            <div style={s.fieldWrap}>
              <label style={s.label}>スタッフメールアドレス</label>
              <div style={s.inputWrap}>
                <span style={s.inputIcon}>✉</span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="staff@riora.jp"
                  required
                  disabled={loading}
                  style={s.input}
                  onFocus={e => (e.currentTarget.style.borderColor = '#d4a17d')}
                  onBlur={e  => (e.currentTarget.style.borderColor = '#f2e4df')}
                />
              </div>
            </div>

            {/* Password */}
            <div style={s.fieldWrap}>
              <label style={s.label}>パスワード</label>
              <div style={s.inputWrap}>
                <span style={{ ...s.inputIcon, fontSize: '14px' }}>🔒</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  style={s.input}
                  onFocus={e => (e.currentTarget.style.borderColor = '#d4a17d')}
                  onBlur={e  => (e.currentTarget.style.borderColor = '#f2e4df')}
                />
              </div>
            </div>

            {/* Error */}
            {error && <div style={s.errorBox}>{error}</div>}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{ ...s.loginBtn, opacity: loading ? 0.65 : 1 }}
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          {/* Separator */}
          <div style={s.separator}>
            <div style={s.sepLine} />
            <span style={s.sepText}>Salon Riora Staff</span>
            <div style={s.sepLine} />
          </div>
        </div>

        {/* Debug Panel */}
        <div style={s.debugBox}>
          <div style={s.debugTitle}>DEBUG</div>
          <div style={s.debugRow}>
            <span style={s.debugKey}>session</span>
            <span style={{ color: debug.hasSession ? '#34D399' : '#d9534f' }}>
              {debug.hasSession ? '✓ active' : '✗ none'}
            </span>
          </div>
          <div style={s.debugRow}>
            <span style={s.debugKey}>uid</span>
            <span style={s.debugVal}>{debug.uid ?? '—'}</span>
          </div>
          <div style={s.debugRow}>
            <span style={s.debugKey}>email</span>
            <span style={s.debugVal}>{debug.email ?? '—'}</span>
          </div>
          <div style={s.debugRow}>
            <span style={s.debugKey}>role</span>
            <span style={s.debugVal}>{debug.role ?? '—'}</span>
          </div>
        </div>

        <p style={s.copyright}>© 2026 Salon Riora Ginza</p>
      </div>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  loadingWrap: {
    background: '#fdf3f2',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#c9a89b',
  },
  page: {
    background: '#fdf3f2',
    fontFamily: "'Noto Sans JP', sans-serif",
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    color: '#6b4a3d',
  },
  container: {
    width: '100%',
    maxWidth: '420px',
    padding: '40px 20px',
    textAlign: 'center',
  },
  charWrap: {
    margin: '0 auto 10px',
    display: 'flex',
    justifyContent: 'center',
  },
  brandTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: '52px',
    fontWeight: 500,
    color: '#4a2c1f',
    marginBottom: '2px',
    letterSpacing: '1px',
    lineHeight: 1.1,
  },
  brandSub: {
    fontSize: '13px',
    letterSpacing: '0.35em',
    color: '#c9a89b',
    marginBottom: '35px',
    fontWeight: 500,
    textTransform: 'uppercase',
  },
  card: {
    background: '#ffffff',
    borderRadius: '28px',
    padding: '40px 30px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.04)',
    textAlign: 'left',
  },
  fieldWrap: { marginBottom: '24px' },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#6b4a3d',
    marginBottom: '8px',
    display: 'block',
  },
  inputWrap: { position: 'relative' },
  inputIcon: {
    position: 'absolute',
    left: '16px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#d8c3bc',
    fontSize: '16px',
    lineHeight: 1,
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    backgroundColor: '#fdf8f7',
    border: '1px solid #f2e4df',
    borderRadius: '14px',
    padding: '14px 16px 14px 48px',
    fontSize: '15px',
    color: '#6b4a3d',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  errorBox: {
    color: '#c0392b',
    fontSize: '13px',
    textAlign: 'center',
    padding: '10px 12px',
    background: 'rgba(192, 57, 43, 0.05)',
    borderRadius: '10px',
    marginBottom: '12px',
    border: '1px solid rgba(192, 57, 43, 0.1)',
  },
  loginBtn: {
    width: '100%',
    backgroundColor: '#6b4a3d',
    color: '#ffffff',
    border: 'none',
    borderRadius: '14px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '10px',
    transition: 'opacity 0.2s',
    fontFamily: "'Noto Sans JP', sans-serif",
    letterSpacing: '0.05em',
  },
  separator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '30px',
    fontSize: '11px',
    color: '#c9a89b',
  },
  sepLine: {
    flex: 1,
    height: '1px',
    background: '#f2e4df',
    maxWidth: '50px',
  },
  sepText: { letterSpacing: '0.08em' },
  debugBox: {
    marginTop: '20px',
    background: 'rgba(107, 74, 61, 0.04)',
    border: '1px solid rgba(107, 74, 61, 0.08)',
    borderRadius: '14px',
    padding: '14px 18px',
    textAlign: 'left',
  },
  debugTitle: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#b09890',
    letterSpacing: '0.12em',
    marginBottom: '8px',
    fontFamily: 'monospace',
  },
  debugRow: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    fontFamily: 'monospace',
    marginBottom: '4px',
  },
  debugKey:  { color: '#c9a89b', minWidth: '52px' },
  debugVal:  { color: '#8a6a60', wordBreak: 'break-all' },
  copyright: {
    marginTop: '40px',
    fontSize: '11px',
    color: '#c9a89b',
    letterSpacing: '0.05em',
  },
}

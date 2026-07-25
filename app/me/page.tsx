'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import MyStatsScreen from '@/components/phase1/MyStatsScreen'

export default function MyStatsPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // DEMO_MODE: 認証チェックをスキップして即表示
    if (DEMO_MODE) {
      setReady(true)
      return
    }

    // /login・ClientShellと同様、getSession()がSafari ITP等で永久ハングしないよう
    // 4秒でタイムアウトする(このページだけタイムアウトが無く、画面中央のローディング
    // ドットが固まったまま進まなくなる不具合があったため追加)。
    let cancelled = false
    const sessionPromise = supabase.auth.getSession()
      .then(({ data }) => data.session)
      .catch(() => null)
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 4000))

    Promise.race([sessionPromise, timeoutPromise]).then(session => {
      if (cancelled) return
      if (!session) {
        router.replace('/login')
        return
      }
      setReady(true)
    })

    return () => { cancelled = true }
  }, [router])

  if (!ready) {
    return (
      <div style={{
        background: '#FFF8F7',
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#c9a89b' }} />
      </div>
    )
  }

  return <MyStatsScreen />
}

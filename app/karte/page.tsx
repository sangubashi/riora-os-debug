'use client'
/**
 * /karte — iPad専用カルテホーム画面(PHASE IPAD-KARTE-ENTRY-1・2026-09-20ユーザー承認)。
 * 認証待ちパターンはapp/customers/page.tsxと同じ(ClientShellのグローバルガードに加えて
 * このページ単体でもセッション確認する既存の慣習を踏襲)。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import KarteEntryScreen from '@/components/karte/KarteEntryScreen'

export default function KartePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (DEMO_MODE) {
      setReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session
      if (!session) {
        router.replace('/login')
        return
      }
      setReady(true)
    })
  }, [router])

  if (!ready) {
    return (
      <div
        style={{
          height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#F7F2EA',
        }}
      >
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#AD8A54' }} />
      </div>
    )
  }

  return <KarteEntryScreen />
}

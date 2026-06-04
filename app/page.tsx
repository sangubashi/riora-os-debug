'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import SplashScreen from '@/components/SplashScreen'

export default function Home() {
  const router = useRouter()
  const didRun = useRef(false)

  useEffect(() => {
    if (didRun.current) return
    didRun.current = true

    const startMs = Date.now()

    // Safari ITP 対策: 3秒タイムアウトで強制解決
    Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session).catch(() => null),
      new Promise<null>(r => setTimeout(() => r(null), 3000)),
    ]).then(session => {
      const elapsed   = Date.now() - startMs
      const remaining = Math.max(0, 800 - elapsed) // スプラッシュ最低 0.8 秒
      setTimeout(() => {
        router.replace(session ? '/phase1' : '/login')
      }, remaining)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <SplashScreen />
}

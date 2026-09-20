'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import SplashScreen from '@/components/SplashScreen'
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants'

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
        // 店舗共通ログイン(PHASE IPAD-KARTE-ENTRY-1・2026-09-20ユーザー承認)のみ`/karte`へ。
        // それ以外(未ログイン・admin・個人ログイン)の既存分岐は無変更
        // (adminを/adminへ振り分ける処理は元々このファイルには無く、今回も追加しない)。
        const target = !session
          ? '/login'
          : session.user.id === SHARED_IPAD_STAFF_USER_ID
            ? '/karte'
            : '/phase1'
        router.replace(target)
      }, remaining)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <SplashScreen />
}

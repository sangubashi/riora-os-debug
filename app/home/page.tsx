'use client'
/**
 * /home → /phase1 リダイレクト
 * 旧モック専用ページは廃止。Phase1Screenを正規ホームとする。
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomeRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/phase1')
  }, [router])

  return (
    <div style={{
      background: '#FFF8F7',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#c9a89b' }} />
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import CustomersScreen from '@/components/phase1/CustomersScreen'

export default function CustomersPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // DEMO_MODE: 認証チェックをスキップして即表示
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

  return <CustomersScreen />
}

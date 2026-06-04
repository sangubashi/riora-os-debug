'use client'
import { motion } from 'framer-motion'
import { Home, Users, Sparkles, BarChart2, LayoutGrid } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'

type NavTab = 'home' | 'customers' | 'ai' | 'kpi' | 'menu'

// AI (FAB) は center なので左2 + 右2 に分割
const LEFT_TABS = [
  { id: 'home'      as NavTab, label: 'ホーム', Icon: Home,     href: '/phase1'    },
  { id: 'customers' as NavTab, label: '顧客',   Icon: Users,    href: '/customers' },
]
const RIGHT_TABS = [
  { id: 'kpi'  as NavTab, label: 'KPI',    Icon: BarChart2, href: '/kpi'  },
  { id: 'menu' as NavTab, label: 'メニュー', Icon: LayoutGrid, href: '/menu' },
]

function resolveTab(pathname: string): NavTab | null {
  if (pathname === '/phase1' || pathname.startsWith('/phase1/')) return 'home'
  if (pathname.startsWith('/customers'))      return 'customers'
  if (pathname.startsWith('/ai-suggestions')) return 'ai'
  if (pathname.startsWith('/kpi'))            return 'kpi'
  if (pathname.startsWith('/menu'))           return 'menu'
  return null
}

export default function AppBottomNav() {
  const pathname = usePathname()
  const router   = useRouter()
  const activeId = resolveTab(pathname)

  const renderTab = (item: { id: NavTab; label: string; Icon: React.ElementType; href: string }) => {
    const isActive = activeId === item.id
    return (
      <button
        key={item.id}
        onClick={() => router.push(item.href)}
        className="flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-1"
      >
        <item.Icon
          size={22}
          style={{ color: isActive ? '#F5A0B5' : '#C8A8B0' }}
          strokeWidth={isActive ? 2.5 : 1.8}
        />
        <span className="text-[10px] font-medium" style={{ color: isActive ? '#F5A0B5' : '#C8A8B0' }}>
          {item.label}
        </span>
        {isActive && (
          <motion.div
            layoutId="shared-nav-dot"
            className="w-1 h-1 rounded-full"
            style={{ background: '#F5A0B5' }}
          />
        )}
      </button>
    )
  }

  return (
    <div
      className="fixed bottom-0 z-30"
      style={{
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '430px',
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid #F5E6E8',
        boxShadow: '0 -4px 20px rgba(245,160,181,0.10)',
      }}
    >
      <div
        className="flex relative"
        style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      >
        {/* 左2タブ */}
        {LEFT_TABS.map(renderTab)}

        {/* 中央AIプレースホルダー */}
        <div className="flex-1 flex flex-col items-center pt-2.5 pb-1">
          <div style={{ height: 22 }} />
          <span className="text-[10px] font-medium" style={{ color: activeId === 'ai' ? '#F5A0B5' : '#C8A8B0' }}>
            AI提案
          </span>
        </div>

        {/* 右2タブ */}
        {RIGHT_TABS.map(renderTab)}

        {/*
          AI FAB — 5タブ中央（3番目）に固定。
          5等分の中央 = 50%。framer-motion transform競合を避けるため calc を使用。
        */}
        <motion.button
          whileTap={{ scale: 0.91 }}
          onClick={() => router.push('/ai-suggestions')}
          style={{
            position: 'absolute',
            left: 'calc(50% - 27px)',
            bottom: 'calc(100% - 24px)',
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #F7C5D5 0%, #D98292 100%)',
            boxShadow: '0 6px 24px rgba(217,130,146,0.45), 0 2px 8px rgba(217,130,146,0.30)',
            border: '2.5px solid rgba(255,255,255,0.90)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 31,
          }}
        >
          <Sparkles size={22} color="white" strokeWidth={2} />
        </motion.button>
      </div>
    </div>
  )
}

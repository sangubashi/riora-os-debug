'use client'
import { motion } from 'framer-motion'
import { Home, Users, Mic, User, Settings } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'

type NavTab = 'today' | 'customers' | 'memo' | 'me' | 'settings'

const TABS: Array<{ id: NavTab; label: string; Icon: React.ElementType; href: string }> = [
  { id: 'today',     label: '今日',   Icon: Home,     href: '/phase1'    },
  { id: 'customers', label: '顧客',   Icon: Users,    href: '/customers' },
  { id: 'memo',      label: 'メモ',   Icon: Mic,      href: '/memo'      },
  { id: 'me',        label: 'わたし', Icon: User,     href: '/me'        },
  { id: 'settings',  label: '設定',   Icon: Settings, href: '/menu'      },
]

function resolveTab(pathname: string): NavTab | null {
  if (pathname === '/phase1' || pathname.startsWith('/phase1/')) return 'today'
  if (pathname.startsWith('/customers')) return 'customers'
  if (pathname.startsWith('/memo'))      return 'memo'
  if (pathname.startsWith('/me'))        return 'me'
  if (pathname.startsWith('/menu'))      return 'settings'
  return null
}

export default function AppBottomNav() {
  const pathname = usePathname()
  const router   = useRouter()
  const activeId = resolveTab(pathname)

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
        {TABS.map(item => {
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
        })}
      </div>
    </div>
  )
}

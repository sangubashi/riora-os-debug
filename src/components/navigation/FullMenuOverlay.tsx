'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  X,
  Home,
  Users,
  Sparkles,
  LayoutList,
  UserCog,
  Package,
  Ticket,
  Tag,
  ChevronRight,
} from 'lucide-react'

type MenuItem = {
  id: string
  label: string
  subLabel: string
  Icon: React.ElementType
  href: string
  accentColor: string
  isNew?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  {
    id: 'home',
    label: 'ホーム',
    subLabel: 'ダッシュボード',
    Icon: Home,
    href: '/phase1',
    accentColor: '#C8A8B0',
  },
  {
    id: 'customers',
    label: '顧客管理',
    subLabel: '顧客一覧・カルテ',
    Icon: Users,
    href: '/customers',
    accentColor: '#F5A0B5',
  },
  {
    id: 'ai',
    label: 'AI提案',
    subLabel: '接客サポート',
    Icon: Sparkles,
    href: '/ai-suggestions',
    accentColor: '#E8A7B4',
  },
  {
    id: 'menu-mgmt',
    label: 'メニュー管理',
    subLabel: '施術・料金',
    Icon: LayoutList,
    href: '/menu',
    accentColor: '#D98292',
  },
  {
    id: 'staff',
    label: 'スタッフ管理',
    subLabel: 'シフト・評価・目標',
    Icon: UserCog,
    href: '/staff',
    accentColor: '#BF8A9E',
    isNew: true,
  },
  {
    id: 'inventory',
    label: '在庫管理',
    subLabel: '消耗品・発注管理',
    Icon: Package,
    href: '/inventory',
    accentColor: '#9EB8C4',
    isNew: true,
  },
  {
    id: 'tickets',
    label: '回数券管理',
    subLabel: '発行・残数・期限',
    Icon: Ticket,
    href: '/tickets',
    accentColor: '#CDA0BC',
    isNew: true,
  },
  {
    id: 'promotions',
    label: '販促・クーポン',
    subLabel: 'キャンペーン・配布',
    Icon: Tag,
    href: '/promotions',
    accentColor: '#D4B896',
    isNew: true,
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export default function FullMenuOverlay({ open, onClose }: Props) {
  const router = useRouter()

  const handleNavigate = (href: string) => {
    onClose()
    router.push(href)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            key="fmo-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(8,3,5,0.80)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={onClose}
          />

          {/* ── Slide-up Panel ── */}
          <motion.div
            key="fmo-panel"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="fixed bottom-0 left-1/2 z-50 w-full"
            style={{
              transform: 'translateX(-50%)',
              maxWidth: '430px',
              borderRadius: '28px 28px 0 0',
              background: 'linear-gradient(180deg, #1E0D14 0%, #13090F 100%)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderBottom: 'none',
              paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
              overflow: 'hidden',
            }}
          >
            {/* Ambient glow at top */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 rounded-full opacity-20 blur-3xl pointer-events-none"
              style={{ background: 'radial-gradient(ellipse, #D98292 0%, transparent 70%)' }}
            />

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-0.5">
              <div className="w-9 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-4">
              <div>
                <p className="text-[9px] tracking-[0.38em] text-white/25 mb-0.5">SALON RIORA</p>
                <h2 className="text-[20px] font-light text-white/88 leading-tight">メニュー</h2>
              </div>
              <motion.button
                whileTap={{ scale: 0.90 }}
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <X size={14} className="text-white/50" />
              </motion.button>
            </div>

            {/* Divider */}
            <div className="mx-5 mb-4 h-px bg-white/6" />

            {/* ── 2-column Grid ── */}
            <div className="grid grid-cols-2 gap-3 px-4">
              {MENU_ITEMS.map((item, i) => (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.045, type: 'spring', damping: 22, stiffness: 280 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleNavigate(item.href)}
                  className="relative flex flex-col gap-2.5 rounded-2xl p-4 text-left overflow-hidden"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                  }}
                >
                  {/* Corner glow */}
                  <div
                    className="absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl pointer-events-none"
                    style={{ background: item.accentColor, opacity: 0.12 }}
                  />

                  {/* NEW badge */}
                  {item.isNew && (
                    <span
                      className="absolute top-3 right-3 text-[8px] font-bold tracking-[0.15em] px-1.5 py-0.5 rounded-full"
                      style={{
                        background: 'rgba(217,130,146,0.18)',
                        color: '#F5A0B5',
                        border: '1px solid rgba(245,160,181,0.25)',
                      }}
                    >
                      NEW
                    </span>
                  )}

                  {/* Icon container */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${item.accentColor}1A`,
                      border: `1px solid ${item.accentColor}28`,
                    }}
                  >
                    <item.Icon size={19} style={{ color: item.accentColor }} strokeWidth={1.5} />
                  </div>

                  {/* Text */}
                  <div className="pr-2">
                    <p className="text-[13px] font-medium text-white/85 leading-tight">{item.label}</p>
                    <p className="text-[10px] text-white/35 mt-0.5 leading-tight">{item.subLabel}</p>
                  </div>

                  {/* Chevron */}
                  <ChevronRight
                    size={11}
                    className="absolute bottom-4 right-3.5 text-white/18"
                  />
                </motion.button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

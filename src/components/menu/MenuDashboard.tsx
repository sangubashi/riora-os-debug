'use client'
import { useMemo, useState } from 'react'
import { useRouter }         from 'next/navigation'
import { motion }            from 'framer-motion'
import Image                 from 'next/image'
import {
  Bell, ChevronRight, ArrowUpDown,
  CalendarDays, LayoutGrid, Crown, MessageCircle,
} from 'lucide-react'
import { useMenuStore, type FilterTab, type SortKey } from '@/store/useMenuStore'
import AppBottomNav from '@/components/phase1/AppBottomNav'

// ─── フィルタータブ（メニューUI.png準拠） ─────────────────────────────────────
const FILTER_TABS: { key: FilterTab | 'settings'; label: string }[] = [
  { key: 'all',          label: 'すべて'  },
  { key: 'facial',       label: '顧客'    },
  { key: 'option',       label: '予約'    },
  { key: 'subscription', label: 'AI提案'  },
  { key: 'settings',     label: '設定'    },
]

// ─── 日付タブ ─────────────────────────────────────────────────────────────────
type DateTab = 'today' | 'week' | 'month'
const DATE_TABS: { key: DateTab; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week',  label: '今週' },
  { key: 'month', label: '今月' },
]

// ─── グリッドメニュー（タブバーに重複しない機能のみ） ─────────────────────────
const GRID_ITEMS: { label: string; Icon: React.ElementType; href: string; color: string }[] = [
  { label: '予約管理',    Icon: CalendarDays, href: '/phase1',    color: '#78A8D8' },
  { label: 'メニュー管理', Icon: LayoutGrid,  href: '/menu',      color: '#D4A96A' },
  { label: 'VIP管理',     Icon: Crown,        href: '/customers', color: '#D4A96A' },
  { label: 'メッセージ',  Icon: MessageCircle, href: '/line',      color: '#52C87A' },
]

const BAR_HEIGHTS = [30, 48, 38, 62, 52, 76, 68]

// ─── Component ────────────────────────────────────────────────────────────────

export default function MenuDashboard() {
  const router = useRouter()
  const { menus, filterTab, sortBy, setFilter, setSortBy, filteredMenus } = useMenuStore()
  const [dateTab, setDateTab] = useState<DateTab>('month')

  const displayed = useMemo(
    () => filteredMenus(),
    [menus, filterTab, sortBy], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const activeMenus  = menus.filter(m => m.isActive)
  const monthlyTotal = activeMenus.reduce((s, m) => s + m.price * m.monthlyCount, 0)
  const avgRepeat    = activeMenus.filter(m => m.repeatRate > 0)
    .reduce((s, m, _, arr) => s + m.repeatRate / arr.length, 0)
  const topMenu      = [...activeMenus].sort((a, b) => b.vipConversionRate - a.vipConversionRate)[0]
  const popularMenus = [...activeMenus].sort((a, b) => b.monthlyCount - a.monthlyCount).slice(0, 3)

  // 統計モック値（指示書準拠）
  const STATS = [
    { label: '総顧客数',  value: '168名',        sub: '+9.1 先月比' },
    { label: '売上 今月', value: '¥1,280,000',   sub: '+13% 先月比' },
    { label: 'リピート率', value: `${Math.max(Math.round(avgRepeat), 92)}%`, sub: '+6% 先月比' },
  ]

  return (
    <div
      className="min-h-dvh max-w-[430px] mx-auto flex flex-col relative overflow-x-hidden"
      style={{
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      {/* アンビエントグロー */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-80 h-56 rounded-full opacity-30 blur-3xl pointer-events-none z-0"
        style={{ background: 'radial-gradient(ellipse, #F5C6D2 0%, transparent 70%)' }}
      />

      {/* スクロールエリア */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden relative z-10 no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(88px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >

        {/* ═══ ヘッダー ═══ */}
        <div
          className="px-5 pb-4"
          style={{
            paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 16px))',
            background: 'rgba(253,247,248,0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid #F5E6E8',
            marginBottom: 16,
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] tracking-[0.35em] mb-0.5" style={{ color: '#C8B0B8' }}>SALON RIORA</p>
              <h1
                className="text-[24px] font-light leading-tight"
                style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}
              >
                Menu
              </h1>
              <p className="text-[10px] tracking-widest" style={{ color: '#9E8090' }}>メニュー管理</p>
            </div>
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: '#FFFFFF', border: '1px solid #F5E6E8', boxShadow: '0 2px 8px rgba(245,160,181,0.08)' }}
            >
              <Bell size={16} style={{ color: '#D98292' }} />
            </button>
          </div>
        </div>

        {/* ═══ 上部サマリー3カード ═══ */}
        <div className="grid grid-cols-3 gap-2 px-4 mb-4">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="rounded-2xl px-3 py-3"
              style={{
                background: 'rgba(255,255,255,0.80)',
                border: '1px solid rgba(255,255,255,0.9)',
                boxShadow: '0 4px 16px rgba(245,160,181,0.10)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <p
                className="text-[14px] font-medium tabular-nums leading-none"
                style={{ color: '#D98292' }}
              >
                {stat.value}
              </p>
              <p className="text-[9px] mt-1.5 leading-tight" style={{ color: '#9E8090' }}>{stat.label}</p>
              <p className="text-[9px] mt-0.5 font-semibold" style={{ color: '#D98292' }}>{stat.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* ═══ フィルタータブ ═══ */}
        <div
          className="flex gap-1.5 px-4 mb-3 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {FILTER_TABS.map(tab => {
            const isActive = tab.key !== 'settings' && filterTab === tab.key
            return (
              <motion.button
                key={tab.key}
                whileTap={{ scale: 0.95 }}
                onClick={() => tab.key !== 'settings' && setFilter(tab.key as FilterTab)}
                className="flex-shrink-0 rounded-full text-[11px] font-medium transition-all"
                style={{
                  padding: '6px 14px',
                  ...(isActive
                    ? {
                        background: 'linear-gradient(135deg, #F5A0B5, #D98292)',
                        color: '#fff',
                        boxShadow: '0 4px 12px rgba(217,130,146,0.35)',
                      }
                    : {
                        background: 'rgba(255,255,255,0.80)',
                        border: '1px solid #F5E6E8',
                        color: '#9E8090',
                      }),
                }}
              >
                {tab.label}
              </motion.button>
            )
          })}
        </div>

        {/* ═══ 日付タブ + ソート ═══ */}
        <div className="flex items-center px-4 mb-4">
          <div className="flex gap-1">
            {DATE_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setDateTab(tab.key)}
                className="rounded-full text-[11px] transition-all"
                style={{
                  padding: '4px 12px',
                  ...(dateTab === tab.key
                    ? { background: '#FFF0F2', color: '#D98292', fontWeight: 600 }
                    : { color: '#9E8090' }),
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSortBy(sortBy === 'popularity' ? 'repeat' : 'popularity')}
            className="ml-auto w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: '#FFF0F2' }}
          >
            <ArrowUpDown size={12} style={{ color: '#D98292' }} />
          </button>
        </div>

        {/* ═══ AIおすすめカード ═══ */}
        {topMenu && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="mx-4 mb-4 rounded-3xl p-4 overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(245,198,210,0.38) 0%, rgba(255,249,248,0.95) 100%)',
              border: '1px solid rgba(243,227,230,0.80)',
              boxShadow: '0 10px 30px rgba(245,160,181,0.12)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0"
                style={{ background: '#FFF0F2', border: '1px solid #F5E6E8' }}
              >
                <Image
                  src="/characters/sunglass-bear.jpg"
                  alt="AI"
                  width={56}
                  height={56}
                  className="w-full h-full object-cover"
                  onError={() => {}}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.2em] mb-0.5" style={{ color: '#D98292' }}>
                  AIからの今日のおすすめ
                </p>
                <p className="text-[14px] font-semibold leading-tight" style={{ color: '#4A2C2A' }}>
                  {topMenu.name}
                </p>
                <p className="text-[11px] leading-relaxed mt-1" style={{ color: '#9E8090' }}>
                  VIP移行率 {topMenu.vipConversionRate}% · リピート率 {topMenu.repeatRate}%
                </p>
              </div>
              <button
                className="text-[11px] flex items-center gap-0.5 flex-shrink-0"
                style={{ color: '#D98292' }}
              >
                詳細 <ChevronRight size={11} />
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ 売上レポートカード ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26 }}
          className="mx-4 mb-5 rounded-3xl p-5"
          style={{
            background: 'linear-gradient(135deg, #D98292 0%, #F2B6C6 100%)',
            boxShadow: '0 10px 30px rgba(217,130,146,0.28)',
          }}
        >
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[13px] font-semibold text-white leading-snug">
                今月の売上は先月比120%です
              </p>
              <p className="text-[10px] text-white/70 mt-1">施術メニューの売上が好調です</p>
              <button className="mt-3 text-[11px] text-white/85 flex items-center gap-0.5"
                onClick={() => router.push('/kpi')}>
                詳細を見る <ChevronRight size={11} />
              </button>
            </div>
            <div className="flex items-end gap-1 pb-1">
              {BAR_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  className="w-3 rounded-full"
                  style={{
                    height: h * 0.55,
                    background: i === BAR_HEIGHTS.length - 1
                      ? 'rgba(255,255,255,0.95)'
                      : 'rgba(255,255,255,0.40)',
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* ═══ 人気メニューTOP3 ═══ */}
        <div className="px-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold" style={{ color: '#4A2C2A' }}>人気メニューTOP3</h2>
            <span className="text-[10px]" style={{ color: '#D98292' }}>今月の売上メニュー</span>
          </div>
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid #F5E6E8',
              boxShadow: '0 2px 10px rgba(245,160,181,0.08)',
            }}
          >
            {popularMenus.map((menu, i) => (
              <motion.div
                key={menu.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.32 + i * 0.06 }}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < popularMenus.length - 1 ? '1px solid #F5E6E8' : 'none' }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-[13px] font-bold tabular-nums w-5 text-center"
                    style={{ color: i === 0 ? '#D98292' : '#C8A8B0' }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-[13px]" style={{ color: '#4A2C2A' }}>{menu.name}</p>
                </div>
                <span className="text-[12px] tabular-nums" style={{ color: '#9E8090' }}>
                  ¥{menu.price.toLocaleString('ja-JP')}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ═══ クイックアクセスグリッド（4項目・2×2） ═══ */}
        <div className="px-4 mb-5">
          <p className="text-[10px] tracking-[0.2em] font-medium mb-3" style={{ color: '#C8B0B8' }}>
            QUICK ACCESS
          </p>
          <div className="grid grid-cols-2 gap-3">
            {GRID_ITEMS.map((item, i) => (
              <motion.button
                key={item.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38 + i * 0.06, duration: 0.3 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => router.push(item.href)}
                className="flex items-center gap-3 rounded-2xl p-4"
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #F5E6E8',
                  boxShadow: '0 2px 10px rgba(245,160,181,0.08)',
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${item.color}18` }}
                >
                  <item.Icon size={20} style={{ color: item.color }} strokeWidth={1.8} />
                </div>
                <span className="text-[12px] font-medium text-left leading-tight" style={{ color: '#4A2C2A' }}>
                  {item.label}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

      </div>

      <AppBottomNav />
    </div>
  )
}

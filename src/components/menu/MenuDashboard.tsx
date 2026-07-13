'use client'
import { useEffect, useMemo } from 'react'
import { useRouter }         from 'next/navigation'
import { motion }            from 'framer-motion'
import Image                 from 'next/image'
import {
  Bell, ChevronRight,
  CalendarDays, MessageCircle, BookOpen,
} from 'lucide-react'
import { useMenuStore, type FilterTab } from '@/store/useMenuStore'
import { DEMO_STORE_ID } from '@/lib/constants'
import AppBottomNav from '@/components/phase1/AppBottomNav'

// ─── フィルタータブ(brain_menus.roleが実データソース。imported_other(CSV未マッチ分)は
//     「すべて」にのみ含め、個別タブは出さない) ─────────────────────────────────
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',       label: 'すべて'        },
  { key: 'entry',     label: 'エントリー'    },
  { key: 'pore',      label: '毛穴ケア'      },
  { key: 'sensitive', label: '低刺激'        },
  { key: 'peeling',   label: 'ピーリング'    },
  { key: 'lifting',   label: 'リフトアップ'  },
]

// ─── グリッドメニュー(ナビゲーションのみ・データ無し) ───────────────────────────
// PHASE MENU-STAFF-CLEANUP-1: 「メニュー管理」ボタンを削除。
// href: '/menu' で自ページ自身を指す未配線の自己参照リンクだったため
// (docs/MENU_STAFF_AUDIT_REPORT.md参照。baseline時点から一度も配線されたことがない)。
const GRID_ITEMS: { label: string; Icon: React.ElementType; href: string; color: string }[] = [
  { label: '予約管理',    Icon: CalendarDays,  href: '/phase1',     color: '#78A8D8' },
  { label: 'メッセージ',  Icon: MessageCircle, href: '/line',       color: '#52C87A' },
  { label: '使い方ガイド', Icon: BookOpen,     href: '/menu/guide', color: '#9E8090' },
]

function formatPct(value: number | null, placeholder = '未実装'): string {
  return value === null ? placeholder : `${value}%`
}

function formatYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MenuDashboard() {
  const router = useRouter()
  const {
    menus, summary, filterTab, isLoading, error,
    setFilter, fetchMenus,
  } = useMenuStore()

  useEffect(() => {
    fetchMenus(DEMO_STORE_ID)
  }, [fetchMenus])

  // imported_other(CSV取込でメニュー名が一致しなかった分の集計用バケット)は実際の
  // 施術メニューではないため、おすすめ・人気ランキングの対象からは除外する
  // (合計売上・メニュー数の集計には含める=summaryはそのまま実データを反映する)。
  const rankableMenus = useMemo(
    () => menus
      .filter(m => m.role !== 'imported_other')
      .filter(m => filterTab === 'all' || m.role === filterTab),
    [menus, filterTab],
  )

  // AIおすすめ: 全期間の次回予約率(実データ)が最も高いメニュー。来店記録が無いメニューしか無ければ対象外。
  const topMenu = [...rankableMenus]
    .filter(m => m.nextVisitRate !== null)
    .sort((a, b) => (b.nextVisitRate ?? 0) - (a.nextVisitRate ?? 0))[0]

  // 人気メニューTOP3: 今月の来店件数(実データ)順。
  const popularMenus = [...rankableMenus].sort((a, b) => b.monthlyCount - a.monthlyCount).slice(0, 3)

  const maxDailyRevenue = Math.max(1, ...(summary?.dailyRevenueLast7Days.map(d => d.revenue) ?? [1]))

  const STATS = [
    {
      label: 'メニュー数',
      value: `${summary?.totalMenuCount ?? menus.length}件`,
      sub:   '現在提供中の施術メニュー',
    },
    {
      label: '売上 今月',
      value: formatYen(summary?.monthlyRevenueTotal ?? 0),
      sub:   summary?.momRevenueChangePct !== null && summary?.momRevenueChangePct !== undefined
        ? `${summary.momRevenueChangePct >= 0 ? '+' : ''}${summary.momRevenueChangePct}% 先月比`
        : '前月データ不足',
    },
    {
      label: 'リピート率',
      value: '集計準備中',
      sub:   '未実装(実データソース無し)',
    },
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
          {error && (
            <p className="text-[10px] mt-2" style={{ color: '#F87171' }}>
              データ取得エラー: {error}
            </p>
          )}
          {isLoading && (
            <p className="text-[10px] mt-2" style={{ color: '#9E8090' }}>読み込み中…</p>
          )}
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

        {/* ═══ フィルタータブ(role実データ) ═══ */}
        <div
          className="flex gap-1.5 px-4 mb-3 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {FILTER_TABS.map(tab => {
            const isActive = filterTab === tab.key
            return (
              <motion.button
                key={tab.key}
                whileTap={{ scale: 0.95 }}
                onClick={() => setFilter(tab.key)}
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

        {/* ═══ AIおすすめカード(次回予約率=実データが最も高いメニュー) ═══ */}
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
                次回予約率トップ(実データ)
              </p>
              <p className="text-[14px] font-semibold leading-tight" style={{ color: '#4A2C2A' }}>
                {topMenu?.name ?? 'データ集計中(来店データ不足)'}
              </p>
              {topMenu && (
                <p className="text-[11px] leading-relaxed mt-1" style={{ color: '#9E8090' }}>
                  次回予約率 {formatPct(topMenu.nextVisitRate, 'データ未蓄積')} · 今月{topMenu.monthlyCount}件
                </p>
              )}
            </div>
            <button
              className="text-[11px] flex items-center gap-0.5 flex-shrink-0"
              style={{ color: '#D98292' }}
            >
              詳細 <ChevronRight size={11} />
            </button>
          </div>
        </motion.div>

        {/* ═══ 売上レポートカード(直近7日間の日別売上=実データ) ═══ */}
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
                {summary?.momRevenueChangePct !== null && summary?.momRevenueChangePct !== undefined
                  ? `今月の売上は先月比${summary.momRevenueChangePct >= 0 ? '+' : ''}${summary.momRevenueChangePct}%です`
                  : '売上比較データ準備中(前月の来店データ不足)'}
              </p>
              <p className="text-[10px] text-white/70 mt-1">直近7日間の日別売上(実データ)</p>
              <button className="mt-3 text-[11px] text-white/85 flex items-center gap-0.5"
                onClick={() => router.push('/me')}>
                詳細を見る <ChevronRight size={11} />
              </button>
            </div>
            <div className="flex items-end gap-1 pb-1">
              {(summary?.dailyRevenueLast7Days ?? []).map((d, i, arr) => (
                <div
                  key={d.date}
                  className="w-3 rounded-full"
                  style={{
                    height: Math.max(4, (d.revenue / maxDailyRevenue) * 56),
                    background: i === arr.length - 1
                      ? 'rgba(255,255,255,0.95)'
                      : 'rgba(255,255,255,0.40)',
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* ═══ 人気メニューTOP3(今月の件数=実データ順) ═══ */}
        <div className="px-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold" style={{ color: '#4A2C2A' }}>人気メニューTOP3</h2>
            <span className="text-[10px]" style={{ color: '#D98292' }}>今月の来店件数順</span>
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
                <div className="text-right">
                  <span className="text-[12px] tabular-nums" style={{ color: '#9E8090' }}>
                    {formatYen(menu.price)}
                  </span>
                  <span className="block text-[9px] tabular-nums" style={{ color: '#C8A8B0' }}>
                    今月{menu.monthlyCount}件
                  </span>
                </div>
              </motion.div>
            ))}
            {popularMenus.length === 0 && (
              <p className="text-[11px] px-4 py-4" style={{ color: '#9E8090' }}>メニューデータがありません</p>
            )}
          </div>
        </div>

        {/* ═══ クイックアクセスグリッド(3項目・2列。奇数件のため最後の1件は幅いっぱいに表示) ═══ */}
        <div className="px-4 mb-5">
          <p className="text-[10px] tracking-[0.2em] font-medium mb-3" style={{ color: '#C8B0B8' }}>
            QUICK ACCESS
          </p>
          <div className="grid grid-cols-2 gap-3">
            {GRID_ITEMS.map((item, i) => {
              const isDanglingLast = GRID_ITEMS.length % 2 !== 0 && i === GRID_ITEMS.length - 1
              return (
              <motion.button
                key={item.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38 + i * 0.06, duration: 0.3 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => router.push(item.href)}
                className={`flex items-center gap-3 rounded-2xl p-4 ${isDanglingLast ? 'col-span-2' : ''}`}
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
              )
            })}
          </div>
        </div>

      </div>

      <AppBottomNav />
    </div>
  )
}

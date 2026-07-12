'use client'
/**
 * MyStatsScreen — 「わたし」タブ（v1最小版）
 *
 * 他人比較・ランキングは一切行わない。表示は自分の先月比のみ。
 * (Riora OS v1.0 再設計書 準拠)
 */
import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import AppBottomNav from './AppBottomNav'
import { useMyStatsStore } from '@/store/useMyStatsStore'
import { useAuthStore } from '@/store/useAuthStore'

function DiffValue({ value, unit }: { value: number; unit: string }) {
  const isZero = value === 0
  const isUp   = value > 0
  // 下降は責めない表示にする(赤ではなく既存の控えめグレー#9E8090を流用)。
  const color  = isUp ? '#52C87A' : '#9E8090'
  const Icon   = isZero ? Minus : isUp ? TrendingUp : TrendingDown
  const sign   = isZero ? '' : isUp ? '+' : ''
  return (
    <div className="flex items-center gap-1" style={{ color }}>
      <Icon size={14} strokeWidth={2.5} />
      <span className="text-[20px] font-bold tabular-nums" style={{ fontFamily: 'Inter, sans-serif' }}>
        {sign}{value}{unit}
      </span>
    </div>
  )
}

export default function MyStatsScreen() {
  const { stats, isLoading, notStaffAccount, fetchStats } = useMyStatsStore()
  const { initialized: authInitialized } = useAuthStore()

  useEffect(() => {
    if (!authInitialized) return
    fetchStats()
  }, [authInitialized, fetchStats])

  const cards = stats ? [
    { label: '先月比 指名',       node: <DiffValue value={stats.nominationDiff} unit="件" /> },
    { label: '先月比 リピート率', node: <DiffValue value={stats.repeatRateDiff} unit="%" /> },
    {
      label: '先月比 口コミ',
      node: stats.reviewCount === null
        ? <span className="text-[14px]" style={{ color: '#C8A8B0' }}>準備中（今後対応）</span>
        : <DiffValue value={stats.reviewCount} unit="件" />,
    },
    { label: '来店数差分',        node: <DiffValue value={stats.visitCountDiff} unit="件" /> },
  ] : []

  return (
    <div
      className="h-dvh flex flex-col overflow-hidden"
      style={{
        width: '100%',
        maxWidth: '430px',
        marginLeft: 'auto',
        marginRight: 'auto',
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      {/* ── ヘッダー ── */}
      <div
        className="flex-shrink-0 px-5"
        style={{
          paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 12px))',
          paddingBottom: '16px',
          background: 'rgba(253,247,248,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #F5E6E8',
        }}
      >
        <p className="text-[10px] font-medium tracking-[0.32em] mb-0.5" style={{ color: '#C8A8B0' }}>
          SALON RIORA
        </p>
        <h1 className="text-[24px] font-light leading-tight" style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}>My Page</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#9E8090' }}>
          先月と比べたご自身の実績です
        </p>
      </div>

      {/* ── コンテンツ ── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(68px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        {isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}
                className="bg-white rounded-[20px] border border-[#F5E6E8] h-[74px] animate-pulse"
                style={{ opacity: 1 - i * 0.1 }}
              />
            ))}
          </div>
        )}

        {!isLoading && stats && cards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white rounded-[20px] border border-[#F5E6E8] flex items-center justify-between px-5 py-4 mb-3"
            style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)' }}
          >
            <span className="text-[13px] font-medium" style={{ color: '#5C4033' }}>
              {card.label}
            </span>
            {card.node}
          </motion.div>
        ))}

        {!isLoading && notStaffAccount && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-[13px]" style={{ color: '#9E8090' }}>
              スタッフアカウントでログインしてください
            </p>
          </div>
        )}

        {!isLoading && !stats && !notStaffAccount && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-[13px]" style={{ color: '#9E8090' }}>
              データを取得できませんでした
            </p>
          </div>
        )}
      </div>

      <AppBottomNav />
    </div>
  )
}

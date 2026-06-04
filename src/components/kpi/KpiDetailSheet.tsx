'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useKpiStore, type KpiKey } from '@/store/useKpiStore'
import TrendBadge from './TrendBadge'

const KPI_META: Record<KpiKey, { label: string; icon: string; description: string }> = {
  todaySales:        { label: '今日の売上',     icon: '💰', description: '本日の施術・商品販売の合計売上' },
  monthlySales:      { label: '月間売上',       icon: '📈', description: '今月の累計売上金額' },
  nextReserveRate:   { label: '次回予約率',     icon: '📅', description: '施術終了時に次回予約を取得できた割合' },
  avgSpend:          { label: '客単価',         icon: '💎', description: '1顧客あたりの平均施術単価' },
  repeatRate:        { label: 'リピート率',     icon: '🔁', description: '過去6ヶ月以内に2回以上来店した顧客の割合' },
  lineResponseRate:  { label: 'LINE返信率',     icon: '💬', description: 'LINEメッセージへの48時間以内の返信率' },
  subscContinueRate: { label: 'サブスク継続率', icon: '🌸', description: 'サブスクリプションプランの継続率' },
  occupancyRate:     { label: '稼働率',         icon: '📅', description: 'スタッフ全体の施術枠に対する実績稼働率' },
  vipRate:           { label: 'VIP比率',        icon: '👑', description: 'VIP顧客が全顧客に占める割合' },
}

function fmt(key: KpiKey, value: number): string {
  if (key === 'todaySales' || key === 'monthlySales' || key === 'avgSpend') {
    if (value >= 1_000_000) return `¥${(value / 10000).toFixed(0)}万`
    if (value >= 10_000)    return `¥${(value / 10000).toFixed(1)}万`
    return `¥${value.toLocaleString('ja-JP')}`
  }
  return `${value}%`
}

function diff(current: number, prev: number): number {
  if (!prev) return 0
  return +((( current - prev) / prev) * 100).toFixed(1)
}

export default function KpiDetailSheet() {
  const { selectedKpi, isSheetOpen, current, previousDay, previousMonth, setSheetOpen } =
    useKpiStore()

  if (!selectedKpi) return null

  const meta       = KPI_META[selectedKpi]
  const curVal     = current[selectedKpi]
  const prevDayVal = previousDay[selectedKpi]
  const prevMonVal = previousMonth[selectedKpi]
  const dayDiff    = diff(curVal, prevDayVal)
  const monthDiff  = diff(curVal, prevMonVal)

  return (
    <AnimatePresence>
      {isSheetOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="kpi-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSheetOpen(false)}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(5,2,4,0.72)', backdropFilter: 'blur(8px)' }}
          />

          {/* Sheet */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center">
            <motion.div
              key="kpi-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0, bottom: 0.3 }}
              onDragEnd={(_, info) => { if (info.offset.y > 80) setSheetOpen(false) }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              className="w-full max-w-[430px] rounded-t-[32px] border-t border-white/10"
              style={{
                background: 'linear-gradient(180deg, #1E0F17 0%, #160B12 100%)',
                paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
              }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-4">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="flex items-start justify-between px-6 pb-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{meta.icon}</span>
                    <h2 className="text-[18px] font-light text-white/90">{meta.label}</h2>
                  </div>
                  <p className="text-[11px] text-white/35 ml-8">{meta.description}</p>
                </div>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0"
                >
                  <X size={15} className="text-white/50" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 flex flex-col gap-3">
                {/* Current value */}
                <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4">
                  <p className="text-[9px] tracking-[0.25em] text-white/30 mb-2">NOW</p>
                  <p className="text-[38px] font-light text-white/95 tabular-nums leading-none">
                    {fmt(selectedKpi, curVal)}
                  </p>
                </div>

                {/* Comparison grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                    <p className="text-[9px] tracking-widest text-white/30 mb-1.5">前日</p>
                    <p className="text-[20px] font-light text-white/65 tabular-nums">
                      {fmt(selectedKpi, prevDayVal)}
                    </p>
                    <div className="mt-2">
                      <TrendBadge value={dayDiff} size="md" />
                    </div>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                    <p className="text-[9px] tracking-widest text-white/30 mb-1.5">前月同日</p>
                    <p className="text-[20px] font-light text-white/65 tabular-nums">
                      {fmt(selectedKpi, prevMonVal)}
                    </p>
                    <div className="mt-2">
                      <TrendBadge value={monthDiff} size="md" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

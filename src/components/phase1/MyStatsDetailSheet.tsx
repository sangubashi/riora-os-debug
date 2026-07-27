'use client'
/**
 * MyStatsDetailSheet — My Pageの前月比カードをタップした際の詳細表示
 *
 * 今月実績・先月実績・差・増減率を表示する。値はAPI(/api/me/monthly-stats)で
 * 既に計算済みのものをそのまま表示するのみで、新しい計算ロジックは持たない。
 * LineUnreadSheet.tsxの軽量BottomSheet構成を踏襲する。
 */
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { MetricDetail } from '@/store/useMyStatsStore'

interface Props {
  isOpen:  boolean
  onClose: () => void
  title:   string
  unit:    '件' | '%' | '円'
  detail:  MetricDetail | null
}

function formatValue(value: number, unit: Props['unit']): string {
  if (unit === '円') return `¥${Math.round(value).toLocaleString('ja-JP')}`
  return `${value}${unit}`
}

function formatDiff(value: number, unit: Props['unit']): string {
  if (value === 0) return formatValue(0, unit)
  const sign = value > 0 ? '+' : '-'
  return unit === '円'
    ? `${sign}¥${Math.abs(Math.round(value)).toLocaleString('ja-JP')}`
    : `${sign}${Math.abs(value)}${unit}`
}

function formatPct(pctChange: number | null): string {
  if (pctChange === null) return '—'
  const sign = pctChange > 0 ? '+' : ''
  return `${sign}${pctChange}%`
}

export default function MyStatsDetailSheet({ isOpen, onClose, title, unit, detail }: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="mystats-detail-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.22)', backdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="mystats-detail-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              className="w-full max-w-[430px] pointer-events-auto rounded-t-[32px] flex flex-col"
              style={{
                maxHeight: '60dvh',
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -4px 32px rgba(245,160,181,0.16), 0 -2px 8px rgba(74,44,42,0.06)',
                border: '1px solid rgba(255,255,255,0.9)',
                borderBottom: 'none',
              }}
            >
              <div className="flex justify-center pt-3.5 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#F5E6E8]" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-b border-[#F5E6E8] flex-shrink-0">
                <h3 className="text-[15px] font-semibold text-salon-brown">{title}の詳細</h3>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
                >
                  <X size={13} className="text-salon-brown-sub" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4" style={{ scrollbarWidth: 'none' }}>
                {detail === null ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <p className="text-[13px]" style={{ color: '#9E8090' }}>計測中です</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {[
                      { label: '先月実績', value: formatValue(detail.lastMonth, unit) },
                      { label: '今月実績', value: formatValue(detail.thisMonth, unit) },
                      { label: '差',       value: formatDiff(detail.diff, unit) },
                      { label: '増減率',   value: formatPct(detail.pctChange) },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between rounded-[16px] px-4 py-3"
                        style={{ background: '#FBF6F7' }}
                      >
                        <span className="text-[13px] font-medium" style={{ color: '#5C4033' }}>{row.label}</span>
                        <span className="text-[16px] font-bold tabular-nums" style={{ color: '#4A2C2A', fontFamily: 'Inter, sans-serif' }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }} />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

'use client'
/**
 * ServiceLogView — クイック接客ログ（3秒で記録）
 *
 * ④ UI指示書２.PNG「クイック接客ログ」に対応
 * 大きなボタン + ピンクベージュ系カラー + 押した瞬間に反応
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Check, X } from 'lucide-react'
import type { Phase1Reservation } from './ReservationCard'

// ─── ログ項目定義 ─────────────────────────────────────────────────────────────
const LOG_ITEMS = [
  { key: 'ai_adopted',     emoji: '✨', label: 'AI提案を活用した',      color: '#F5A0B5', bg: '#FFF5F8' },
  { key: 'next_reserved',  emoji: '📅', label: '次回予約が取れた',      color: '#78C890', bg: '#F5FBF7' },
  { key: 'option_sold',    emoji: '💎', label: 'オプションを提案した',  color: '#D4A96A', bg: '#FFFAF0' },
  { key: 'retail_sold',    emoji: '🛍', label: '物販が売れた',          color: '#9EB4D8', bg: '#F5F8FD' },
  { key: 'churn_followed', emoji: '💌', label: '離脱フォローをした',    color: '#E88AAE', bg: '#FFF5F8' },
] as const

type LogKey = typeof LOG_ITEMS[number]['key']

interface Props {
  reservation: Phase1Reservation
  onBack:      () => void
  onSaved:     () => void
}

export default function ServiceLogView({ reservation: r, onBack, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<LogKey>>(new Set())
  const [saved,    setSaved]    = useState(false)

  function toggle(key: LogKey) {
    if (saved) return
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function handleSave() {
    if (saved) return
    setSaved(true)
    // TODO: supabase.from('staff_logs').insert(...)
    setTimeout(() => { onSaved() }, 1800)
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-center pointer-events-none">
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 280 }}
      className="w-full max-w-[430px] pointer-events-auto flex flex-col"
      style={{ background: 'linear-gradient(180deg, #F8F1F3 0%, #FDFAF9 100%)' }}
    >
      {/* ── ナビバー ── */}
      <div
        className="flex items-center px-4 flex-shrink-0"
        style={{ paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 12px))', paddingBottom: '8px' }}
      >
        <motion.button whileTap={{ scale: 0.92 }} onClick={onBack} className="flex items-center gap-1 text-salon-brown-sub">
          <ChevronLeft size={20} />
          <span className="text-[14px]">戻る</span>
        </motion.button>
        <div className="flex-1 text-center">
          <span className="text-[15px] font-semibold text-salon-brown">接客ログを記録</span>
        </div>
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: '#F5E6E8' }}
        >
          <X size={14} className="text-salon-brown-sub" />
        </button>
      </div>

      {/* ── コンテンツ ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 no-scrollbar" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: '100px' }}>

        {/* 顧客チップ */}
        <div
          className="flex items-center justify-between rounded-[16px] border border-[#F5E6E8] px-4 py-3 mb-5"
          style={{ background: '#FFFFFF' }}
        >
          <div>
            <p className="text-[15px] font-semibold text-salon-brown">{r.customerName} 様</p>
            <p className="text-[12px] text-salon-brown-sub">{r.menu}</p>
          </div>
          <span className="text-[11px] text-salon-brown-sub">{r.durationMinutes}分</span>
        </div>

        {/* 3秒記録タイトル */}
        <div className="text-center mb-4">
          <p className="text-[11px] font-semibold text-salon-pink tracking-[0.18em]">3秒で記録</p>
          <p className="text-[12px] text-salon-brown-sub mt-0.5">該当するものをタップしてください</p>
        </div>

        {/* ── ログボタン群 ── */}
        <div className="flex flex-col gap-3">
          {LOG_ITEMS.map((item, i) => {
            const isOn = selected.has(item.key)
            return (
              <motion.button
                key={item.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileTap={saved ? {} : { scale: 0.97 }}
                onClick={() => toggle(item.key)}
                className="w-full flex items-center justify-between rounded-[18px] px-4 py-4 border transition-all"
                style={{
                  background: isOn ? item.bg : '#FFFFFF',
                  borderColor: isOn ? item.color + '60' : '#F5E6E8',
                  boxShadow: isOn ? `0 2px 12px ${item.color}20` : '0 1px 4px rgba(245,160,181,0.06)',
                }}
              >
                <div className="flex items-center gap-4">
                  <span className="text-[26px] leading-none">{item.emoji}</span>
                  <span
                    className="text-[14px] font-medium"
                    style={{ color: isOn ? item.color : '#7A5058' }}
                  >
                    {item.label}
                  </span>
                </div>
                <div
                  className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    background:  isOn ? item.color : 'transparent',
                    border:      `2px solid ${isOn ? item.color : '#DFC0C5'}`,
                  }}
                >
                  <AnimatePresence>
                    {isOn && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <Check size={12} className="text-white" strokeWidth={3} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* ── 保存ボタン ── */}
      <div
        className="flex-shrink-0 px-4 pt-3"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))', background: 'rgba(253,250,249,0.96)' }}
      >
        <motion.button
          whileTap={saved ? {} : { scale: 0.97 }}
          onClick={handleSave}
          disabled={saved}
          className="w-full py-4 rounded-full text-[15px] font-semibold transition-all"
          style={{
            background: saved
              ? 'linear-gradient(135deg, #52C87A, #3DB060)'
              : selected.size > 0
                ? 'linear-gradient(135deg, #F5A0B5, #F0879E)'
                : '#F5E6E8',
            color: saved || selected.size > 0 ? '#FFFFFF' : '#C8A8B0',
            boxShadow: saved
              ? '0 4px 14px rgba(82,200,122,0.35)'
              : selected.size > 0
                ? '0 4px 14px rgba(245,160,181,0.40)'
                : 'none',
          }}
        >
          {saved ? '✓ 保存しました' : `保存する${selected.size > 0 ? ` (${selected.size}件)` : ''}`}
        </motion.button>
      </div>
    </motion.div>
    </div>
  )
}

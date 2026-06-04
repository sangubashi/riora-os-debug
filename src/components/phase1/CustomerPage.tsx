'use client'
/**
 * CustomerPage — 顧客個別ページ
 *
 * ・上部: サングラスのくま（大） + 顧客名
 * ・中部: AI提案を見るボタン
 * ・下部: メモ機能（編集アイコン付き）
 */
import { useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ChevronLeft, Pencil, Check, Sparkles, Calendar, TrendingUp, X } from 'lucide-react'
import type { Phase1Reservation } from './ReservationCard'

const TYPE_COLOR: Record<string, string> = {
  'VIP型':       '#D4A96A',
  '慎重・不安型': '#9EB4D8',
  '感情重視型':   '#E88AAE',
  '効果重視型':   '#78C890',
  '信頼構築型':   '#D8A878',
}

function formatYen(n: number) {
  if (n >= 1_000_000) return `¥${(n/10000).toFixed(0)}万`
  if (n >= 10_000)    return `¥${(n/10000).toFixed(1)}万`
  return `¥${n.toLocaleString('ja-JP')}`
}

interface Props {
  reservation:  Phase1Reservation
  onBack:       () => void
  onAiProposal: (r: Phase1Reservation) => void
}

export default function CustomerPage({ reservation: r, onBack, onAiProposal }: Props) {
  const [memo,        setMemo]        = useState('')
  const [isEditMemo,  setIsEditMemo]  = useState(false)
  const [savedMemo,   setSavedMemo]   = useState('前回は乾燥肌をご相談。保湿ケアに関心あり。')
  const color = TYPE_COLOR[r.customerType] ?? '#9E8090'

  const handleSaveMemo = () => {
    if (memo.trim()) setSavedMemo(memo.trim())
    setIsEditMemo(false)
    setMemo('')
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 280 }}
      className="fixed inset-y-0 z-50 flex flex-col"
      style={{ left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', background: 'linear-gradient(180deg, #F8F1F3 0%, #FDFAF9 100%)' }}
    >
      {/* ── ヘッダーバー ── */}
      <div
        className="flex items-center px-4 flex-shrink-0"
        style={{ paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 12px))', paddingBottom: '12px' }}
      >
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={onBack}
          className="flex items-center gap-1 text-salon-brown-sub"
        >
          <ChevronLeft size={20} />
          <span className="text-[14px]">戻る</span>
        </motion.button>
        <div className="flex-1" />
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: '#F5E6E8' }}
        >
          <X size={14} className="text-salon-brown-sub" />
        </button>
      </div>

      {/* ── スクロールエリア ── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none', paddingBottom: '32px' }}>

        {/* ── サングラスのくま + 顧客名（上部） ── */}
        <div
          className="relative flex flex-col items-center pt-6 pb-8 mx-4 mb-4 rounded-[28px]"
          style={{ background: 'linear-gradient(160deg, #FFF0F5 0%, #FDF5EE 100%)' }}
        >
          {/* 背景グロー */}
          <div
            className="absolute inset-0 rounded-[28px] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(245,160,181,0.18) 0%, transparent 65%)' }}
          />

          {/* サングラスのくま（大） */}
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10"
          >
            <Image
              src="/assets/rio-kuma.png"
              alt="サロンくま"
              width={120}
              height={120}
              className="object-contain drop-shadow-lg"
              style={{ filter: 'drop-shadow(0 8px 20px rgba(245,160,181,0.30))' }}
            />
          </motion.div>

          {/* 顧客名 */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="relative z-10 text-center mt-3"
          >
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-[22px] font-semibold text-salon-brown">{r.customerName} 様</h1>
              {r.isVip && (
                <span
                  className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white"
                  style={{ background: 'linear-gradient(135deg, #E8C88A, #D4A96A)' }}
                >
                  VIP
                </span>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 mt-1.5">
              <span className="text-[12px] font-medium" style={{ color }}>{r.customerType}</span>
              <span className="text-[11px] text-salon-brown-sub">
                来店{r.visitCount}回 · {r.daysSinceLastVisit}日前
              </span>
            </div>
          </motion.div>
        </div>

        {/* ── 主要統計 3つ ── */}
        <div className="grid grid-cols-3 gap-2 mx-4 mb-4">
          {[
            { label: '来店回数', value: `${r.visitCount}回`,        icon: Calendar,   color: '#F5A0B5' },
            { label: '総売上',   value: formatYen(r.totalSpent),    icon: TrendingUp,  color: '#D4A96A' },
            { label: 'AI一致',  value: `${r.aiScore}%`,             icon: Sparkles,    color: '#78C890' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              className="bg-white rounded-[16px] border border-[#F5E6E8] p-3 flex flex-col items-center gap-1"
              style={{ boxShadow: '0 2px 8px rgba(245,160,181,0.08)' }}
            >
              <stat.icon size={14} style={{ color: stat.color }} />
              <span className="text-[15px] font-semibold text-salon-brown tabular-nums">{stat.value}</span>
              <span className="text-[9px] text-salon-brown-sub">{stat.label}</span>
            </motion.div>
          ))}
        </div>

        {/* ── AI提案を見るボタン ── */}
        <div className="mx-4 mb-4">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onAiProposal(r)}
            className="w-full py-4 rounded-[20px] text-white text-[15px] font-semibold flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #F5A0B5, #F0879E)',
              boxShadow: '0 4px 16px rgba(245,160,181,0.40)',
            }}
          >
            <Sparkles size={18} />
            AI 提案を見る
          </motion.button>
        </div>

        {/* ── メニュー情報 ── */}
        <div
          className="mx-4 mb-4 rounded-[20px] border border-[#F5E6E8] p-4"
          style={{ background: '#FDFAF9' }}
        >
          <p className="text-[10px] font-semibold tracking-[0.18em] text-salon-pink mb-2">TODAY'S MENU</p>
          <p className="text-[14px] font-medium text-salon-brown">{r.menu}</p>
          <p className="text-[12px] text-salon-brown-sub mt-1">{r.durationMinutes}分 · {formatTime(r.scheduledAt)}〜</p>
        </div>

        {/* ── メモ機能（下部・編集アイコン付き）── */}
        <div className="mx-4 mb-4">
          <div
            className="rounded-[20px] border border-[#F5E6E8] overflow-hidden"
            style={{ background: '#FFFFFF', boxShadow: '0 2px 8px rgba(245,160,181,0.08)' }}
          >
            {/* メモヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#F5E6E8]">
              <p className="text-[12px] font-semibold text-salon-brown">📝 接客メモ</p>
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { setIsEditMemo(!isEditMemo); if (!isEditMemo) setMemo(savedMemo) }}
                className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
              >
                {isEditMemo
                  ? <Check size={13} className="text-salon-success" />
                  : <Pencil size={13} className="text-salon-brown-sub" />
                }
              </motion.button>
            </div>

            {/* メモ本文 */}
            <div className="px-4 py-3">
              {isEditMemo ? (
                <div>
                  <textarea
                    value={memo}
                    onChange={e => setMemo(e.target.value)}
                    placeholder="接客メモを入力…"
                    rows={3}
                    autoFocus
                    className="w-full text-[13px] text-salon-brown bg-transparent resize-none outline-none leading-relaxed placeholder:text-salon-brown-light"
                    style={{ fontFamily: 'inherit' }}
                  />
                  <div className="flex justify-end mt-2">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={handleSaveMemo}
                      className="px-4 py-1.5 rounded-full text-[12px] font-medium text-white"
                      style={{ background: 'linear-gradient(135deg, #F5A0B5, #F0879E)' }}
                    >
                      保存
                    </motion.button>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-salon-brown leading-relaxed whitespace-pre-wrap">
                  {savedMemo || <span className="text-salon-brown-light">メモなし</span>}
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </motion.div>
  )
}

function formatTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }) }
  catch { return iso.slice(11,16) }
}

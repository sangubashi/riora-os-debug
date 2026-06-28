'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ChevronLeft, ClipboardList, X } from 'lucide-react'
import type { Phase1Reservation } from './ReservationCard'

interface ProposalData {
  found:         boolean
  customerType?: string
  advice?:       string | null
  avoidNote?:    string | null
  menuSuggestion?: string | null
  recentMenus?:  string[]
  candidateDate?: string | null
}

interface Props {
  reservation:  Phase1Reservation
  onBack:       () => void
  onServiceLog: (r: Phase1Reservation) => void
}

export default function AIProposalView({ reservation: r, onBack, onServiceLog }: Props) {
  const [proposal, setProposal] = useState<ProposalData | null>(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/proposals/by-name?customerName=${encodeURIComponent(r.customerName)}`)
      .then(res => res.ok ? res.json() : null)
      .then((data: ProposalData | null) => setProposal(data))
      .catch(() => setProposal(null))
      .finally(() => setLoading(false))
  }, [r.customerName])

  const cards = [
    {
      key:   'TODAY',
      color: '#F5A0B5',
      bg:    '#FFF5F8',
      label: "TODAY'S AIM",
      value: proposal?.advice ?? null,
    },
    {
      key:   'MENU',
      color: '#D4A96A',
      bg:    '#FFFAF0',
      label: 'RECOMMENDED MENU',
      value: proposal?.menuSuggestion ?? (proposal?.recentMenus?.[0] ?? null),
    },
    {
      key:   'NEXT',
      color: '#9EB4D8',
      bg:    '#F5F8FD',
      label: 'NEXT BOOKING TIP',
      value: proposal?.candidateDate ? `次回候補日: ${proposal.candidateDate}` : null,
    },
  ].filter(c => c.value)

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 280 }}
      className="fixed inset-y-0 z-[55] flex flex-col"
      style={{ left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', background: 'linear-gradient(180deg, #F8F1F3 0%, #FDFAF9 100%)' }}
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
          <span className="text-[15px] font-semibold text-salon-brown">AI 提案</span>
        </div>
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: '#F5E6E8' }}
        >
          <X size={14} className="text-salon-brown-sub" />
        </button>
      </div>

      {/* ── スクロールエリア ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-2 no-scrollbar" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: '100px' }}>

        {/* くま + 顧客名 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center py-5 mb-4 rounded-[24px]"
          style={{ background: 'linear-gradient(160deg, #FFF0F5, #FDF5EE)' }}
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Image
              src="/assets/rio-kuma.png"
              alt="AI アドバイザー"
              width={88}
              height={88}
              className="object-contain"
              style={{ filter: 'drop-shadow(0 6px 16px rgba(245,160,181,0.28))' }}
            />
          </motion.div>
          <p className="text-[13px] font-semibold text-salon-brown mt-2">{r.customerName} 様への AI 提案</p>
          <p className="text-[11px] text-salon-brown-sub mt-0.5">{proposal?.customerType ?? r.customerType}</p>
        </motion.div>

        {/* ロード中 */}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-[#F5A0B5] border-t-transparent animate-spin" />
          </div>
        )}

        {/* 提案カード群 */}
        {!loading && (
          <div className="flex flex-col gap-3">
            {cards.length === 0 ? (
              <div className="rounded-[20px] border border-[#F5E6E8] p-6 text-center" style={{ background: '#FFF5F8' }}>
                <p className="text-[13px] text-salon-brown-sub">提案データを取得できませんでした</p>
              </div>
            ) : (
              cards.map((card, i) => (
                <motion.div
                  key={card.key}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="rounded-[20px] border p-4"
                  style={{
                    background:   card.bg,
                    borderColor:  card.color + '30',
                    boxShadow:    `0 2px 10px ${card.color}14`,
                  }}
                >
                  <p className="text-[9px] font-bold tracking-[0.22em] mb-1.5" style={{ color: card.color }}>
                    {card.label}
                  </p>
                  <p className="text-[13px] text-salon-brown leading-relaxed">{card.value}</p>
                </motion.div>
              ))
            )}

            {/* NG ワード */}
            {proposal?.avoidNote && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.28 }}
                className="rounded-[20px] border border-red-200/50 p-4 bg-red-50/60"
              >
                <p className="text-[9px] font-bold tracking-[0.22em] text-salon-danger mb-1.5">NG WORDS</p>
                <p className="text-[13px] text-salon-danger/80 leading-relaxed">{proposal.avoidNote}</p>
              </motion.div>
            )}

            {/* 直近メニュー */}
            {(proposal?.recentMenus ?? []).length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 }}
                className="rounded-[20px] border border-[#F5E6E8] p-4"
                style={{ background: '#FFFFFF' }}
              >
                <p className="text-[9px] font-bold tracking-[0.22em] mb-2" style={{ color: '#C8B0B8' }}>RECENT MENUS</p>
                <div className="flex flex-wrap gap-1.5">
                  {(proposal?.recentMenus ?? []).map((m, i) => (
                    <span key={i} className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: '#F5E6E8', color: '#4A2C2A' }}>
                      {m}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* ── 接客ログを記録するボタン ── */}
      <div
        className="flex-shrink-0 px-4 pt-3"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))', background: 'rgba(253,250,249,0.96)' }}
      >
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => onServiceLog(r)}
          className="w-full py-4 rounded-full text-white text-[15px] font-semibold flex items-center justify-center gap-2"
          style={{
            background:  'linear-gradient(135deg, #5A3840, #4A2C2A)',
            boxShadow:   '0 4px 14px rgba(74,44,42,0.30)',
          }}
        >
          <ClipboardList size={18} />
          接客ログを記録する
        </motion.button>
      </div>
    </motion.div>
  )
}

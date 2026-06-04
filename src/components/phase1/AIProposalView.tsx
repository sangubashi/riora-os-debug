'use client'
/**
 * AIProposalView — AI提案表示画面
 *
 * ③ UI指示書２.PNG「AI提案表示」に対応
 * サングラスくま + AI提案カード4種 + 接客ログを記録するボタン
 */
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ChevronLeft, ClipboardList, X } from 'lucide-react'
import type { Phase1Reservation, CustomerType } from './ReservationCard'

// ─── タイプ別AI提案 ───────────────────────────────────────────────────────────
const AI_CONTENT: Record<CustomerType, {
  advice:   string
  menu:     string
  option:   string
  ng:       string
  timing:   string
}> = {
  'VIP型': {
    advice:   '田中様には特別感を最大限に演出することをお勧めします。他では得られない体験を提供し、信頼関係をさらに深めましょう。',
    menu:     'プレミアムエイジングケア（90分）',
    option:   '美白トリートメント or コラーゲンパック',
    ng:       '「他のお客様も使っています」などの一般化表現はお避けください',
    timing:   '施術終了15分前に次回予約をご提案することをお勧めします',
  },
  '慎重・不安型': {
    advice:   '安心感を最優先にお考えください。強い提案は控え、まず信頼を積み重ねることが大切です。',
    menu:     'モイスチャーフェイシャル（保湿中心）',
    option:   'コラーゲンパック（安心感重視）',
    ng:       '「絶対に効果があります」などの断言表現はお避けください',
    timing:   '雑談の中で自然に次回予約をご提案することをお勧めします',
  },
  '感情重視型': {
    advice:   '感情的なつながりを大切に。共感の言葉と温かいトーンで接客することをお勧めします。',
    menu:     'リラクゼーションコース',
    option:   'ヘッドスパ（リラックス効果高）',
    ng:       '事務的・数値的な表現はお控えください',
    timing:   '感謝の言葉を伝えながら次回をご提案ください',
  },
  '効果重視型': {
    advice:   '具体的な変化・数値をお伝えし、次回予約につなげることをお勧めします。',
    menu:     'ポアクリーニング + 美白ケア',
    option:   '美白トリートメント（効果訴求）',
    ng:       '「個人差があります」の多用はお避けください',
    timing:   '施術結果を見せながら次回予約をご提案ください',
  },
  '信頼構築型': {
    advice:   '定期来店の習慣化を丁寧に促進してください。焦らず長期的な関係構築を意識しましょう。',
    menu:     'ベーシックフェイシャル',
    option:   'デコルテマッサージ（リラックス系）',
    ng:       '「今日だけの特別価格」などの圧力表現はお避けください',
    timing:   '次回の来店目安をさりげなくお伝えください',
  },
}

interface Props {
  reservation:    Phase1Reservation
  onBack:         () => void
  onServiceLog:   (r: Phase1Reservation) => void
}

export default function AIProposalView({ reservation: r, onBack, onServiceLog }: Props) {
  const content = AI_CONTENT[r.customerType] ?? AI_CONTENT['信頼構築型']

  const cards = [
    { key: 'TODAY',     color: '#F5A0B5', bg: '#FFF5F8', label: "TODAY'S AIM",        value: content.advice   },
    { key: 'MENU',      color: '#D4A96A', bg: '#FFFAF0', label: 'RECOMMENDED MENU',   value: content.menu     },
    { key: 'OPTION',    color: '#78C890', bg: '#F5FBF7', label: 'RECOMMENDED OPTION', value: content.option   },
    { key: 'TIMING',    color: '#9EB4D8', bg: '#F5F8FD', label: 'NEXT BOOKING TIP',   value: content.timing   },
  ]

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
          <p className="text-[11px] text-salon-brown-sub mt-0.5">{r.customerType}</p>
        </motion.div>

        {/* 提案カード群 */}
        <div className="flex flex-col gap-3">
          {cards.map((card, i) => (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 }}
              className="rounded-[20px] border p-4"
              style={{
                background: card.bg,
                borderColor: card.color + '30',
                boxShadow: `0 2px 10px ${card.color}14`,
              }}
            >
              <p
                className="text-[9px] font-bold tracking-[0.22em] mb-1.5"
                style={{ color: card.color }}
              >
                {card.label}
              </p>
              <p className="text-[13px] text-salon-brown leading-relaxed">{card.value}</p>
            </motion.div>
          ))}

          {/* NG ワード */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.28 }}
            className="rounded-[20px] border border-red-200/50 p-4 bg-red-50/60"
          >
            <p className="text-[9px] font-bold tracking-[0.22em] text-salon-danger mb-1.5">NG WORDS</p>
            <p className="text-[13px] text-salon-danger/80 leading-relaxed">{content.ng}</p>
          </motion.div>
        </div>
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
            background: 'linear-gradient(135deg, #5A3840, #4A2C2A)',
            boxShadow: '0 4px 14px rgba(74,44,42,0.30)',
          }}
        >
          <ClipboardList size={18} />
          接客ログを記録する
        </motion.button>
      </div>
    </motion.div>
  )
}

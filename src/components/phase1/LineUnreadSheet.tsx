'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MessageCircle, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

// ─── モック未返信データ ──────────────────────────────────────────────────────
const MOCK_LINE_UNREADS = [
  { id: '1', customerName: '山田 美沙',   lastMessage: '予約の変更について確認したいのですが…',  unreadCount: 3, timeAgo: '2時間前',  churnRisk: 76 },
  { id: '2', customerName: '伊藤 さくら', lastMessage: '次回いつ頃空いていますか？',              unreadCount: 1, timeAgo: '5時間前',  churnRisk: 14 },
  { id: '3', customerName: '鈴木 花子',   lastMessage: 'ありがとうございました！またよろしくお願いします', unreadCount: 2, timeAgo: '昨日', churnRisk: 18 },
] as const

export const LINE_UNREAD_COUNT = MOCK_LINE_UNREADS.reduce((s, c) => s + c.unreadCount, 0)

interface Props {
  isOpen:  boolean
  onClose: () => void
}

export default function LineUnreadSheet({ isOpen, onClose }: Props) {
  const router = useRouter()

  function goToLine() {
    onClose()
    router.push('/line')
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── オーバーレイ ── */}
          <motion.div
            key="line-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.22)', backdropFilter: 'blur(6px)' }}
          />

          {/* ── Bottom Sheet ── */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="line-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              className="w-full max-w-[430px] pointer-events-auto rounded-t-[32px] flex flex-col"
              style={{
                maxHeight: '72dvh',
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -4px 32px rgba(245,160,181,0.16), 0 -2px 8px rgba(74,44,42,0.06)',
                border: '1px solid rgba(255,255,255,0.9)',
                borderBottom: 'none',
              }}
            >
              {/* ドラッグハンドル */}
              <div className="flex justify-center pt-3.5 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#F5E6E8]" />
              </div>

              {/* ヘッダー */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#F5E6E8] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} style={{ color: '#78C890' }} />
                  <h3 className="text-[15px] font-semibold text-salon-brown">未返信 LINE</h3>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: '#E84050' }}
                  >
                    {LINE_UNREAD_COUNT}
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
                >
                  <X size={13} className="text-salon-brown-sub" />
                </button>
              </div>

              {/* 顧客リスト */}
              <div
                className="flex-1 overflow-y-auto no-scrollbar"
                style={{ scrollbarWidth: 'none' }}
              >
                {MOCK_LINE_UNREADS.map((item, i) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    whileTap={{ backgroundColor: '#FFF5F8' }}
                    onClick={goToLine}
                    className="w-full flex items-center gap-3 px-5 py-4 border-b border-[#F5E6E8] text-left"
                  >
                    {/* アバター */}
                    <div
                      className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #FDF5F7, #F8EAF0)' }}
                    >
                      <Image src="/assets/rio-kuma.png" alt="くま" width={40} height={40} className="object-contain" />
                    </div>

                    {/* テキスト */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[13px] font-semibold text-salon-brown">
                          {item.customerName} 様
                        </span>
                        <span className="text-[10px] text-salon-brown-sub">{item.timeAgo}</span>
                      </div>
                      <p className="text-[12px] text-salon-brown-sub truncate">{item.lastMessage}</p>
                    </div>

                    {/* 未読バッジ */}
                    <span
                      className="flex-shrink-0 min-w-[20px] h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1.5"
                      style={{ background: '#E84050' }}
                    >
                      {item.unreadCount}
                    </span>
                  </motion.button>
                ))}
              </div>

              {/* LINE CRMを開くボタン */}
              <div
                className="flex-shrink-0 px-5 pt-3"
                style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))', background: 'rgba(255,255,255,0.98)' }}
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={goToLine}
                  className="w-full py-3.5 rounded-full text-white text-[14px] font-semibold flex items-center justify-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, #52C87A, #3DB060)',
                    boxShadow: '0 4px 14px rgba(82,200,122,0.35)',
                  }}
                >
                  <MessageCircle size={16} />
                  LINE CRM を開く
                  <ChevronRight size={16} />
                </motion.button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

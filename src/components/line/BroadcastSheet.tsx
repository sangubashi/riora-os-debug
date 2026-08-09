'use client'
/**
 * BroadcastSheet.tsx — 一括配信シート
 *
 * PHASE LINE-BROADCAST-SAFE-1: 実機検証で、
 *   - セグメント別の対象人数(REACH定数)が全てハードコードされた架空値
 *   - 送信ボタンがLINE Messaging APIを一切呼ばず、2秒後に「✓ 配信しました」
 *     という偽の成功表示を出すだけ(handleSend()内のTODOコメントの通り未実装)
 * であることが判明したため、対象人数の表示・送信フローを一旦すべて外し、
 * 「準備中」であることが明確に分かる表示のみに置き換える。
 *
 * 今回は一括配信機能そのものを実装しない(対象人数集計・LINE一括送信・
 * line_campaigns等は別タスク)。既存の1件単位のLINE送信(ChatWindow.tsx側)には
 * 一切影響しない。
 */
import { AnimatePresence, motion } from 'framer-motion'
import { X, Send } from 'lucide-react'
import { useLineCrmStore } from '@/store/useLineStore'

export default function BroadcastSheet() {
  const { isBroadcastOpen, closeBroadcast } = useLineCrmStore()

  return (
    <AnimatePresence>
      {isBroadcastOpen && (
        <>
          <motion.div
            key="bc-bg"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeBroadcast}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(92,64,51,0.2)', backdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center">
            <motion.div
              key="bc-sheet"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              drag="y" dragConstraints={{ top: 0 }} dragElastic={{ top: 0, bottom: 0.3 }}
              onDragEnd={(_, info) => { if (info.offset.y > 80) closeBroadcast() }}
              className="w-full max-w-[430px] bg-white rounded-t-[28px]"
              style={{
                boxShadow: '0 -8px 40px rgba(92,64,51,0.14)',
                paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#E8D5D8]" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#F3E3E6] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Send size={15} className="text-[#D98292]" />
                  <span className="text-[15px] font-semibold text-[#5C4033]">一括配信</span>
                </div>
                <button onClick={closeBroadcast} className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center">
                  <X size={13} className="text-[#C8A58C]" />
                </button>
              </div>

              {/* 準備中notice(PHASE LINE-BROADCAST-SAFE-1) */}
              <div className="px-5 py-12 flex flex-col items-center text-center gap-3">
                <Send size={28} className="text-[#E0C4CA]" />
                <p className="text-[14px] font-semibold text-[#5C4033]">一括配信は現在準備中です</p>
                <p className="text-[12px] text-[#9F7E6C] leading-relaxed">
                  対象人数の集計・一斉送信機能は現在ご利用いただけません。<br />
                  お客様へのご案内は、これまで通り顧客詳細画面からLINEメッセージを作成し、
                  1件ずつLINEアプリで送信してください。
                </p>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

'use client'
/**
 * BriefingTargetsSheet — Today Briefingの通知タップ時「対象顧客一覧」
 * (PHASE STAFF-NOTIFICATION-TAP-1)
 *
 * 「禁忌事項があります（2名）」のように対象が複数いる通知をタップした際に、
 * 対象顧客の一覧を表示し、1人を選ぶとCustomer Bottom Sheetへ遷移させるための
 * 中間選択シート。新しいページは作らず、既存のNotificationSheet.tsx(アプリ内通知
 * センター)と同じボトムシートの見た目・操作(overlay+スプリングアニメーション・
 * rounded-t-[32px]・backdrop blur)をそのまま踏襲している(Glassデザイン維持)。
 *
 * 対象が1名のみの場合、呼び出し側(TodayBriefingSummaryCard)はこのシートを開かず
 * 直接onSelectCustomerを呼ぶ設計のため、このシートは常に2名以上を表示する。
 */
import { motion, AnimatePresence } from 'framer-motion'
import { X, User } from 'lucide-react'
import type { TodayBriefingNotificationTarget } from '@/types/todayBriefing'
import { C } from './TodayBriefingCard'

interface Props {
  isOpen:  boolean
  title:   string
  targets: TodayBriefingNotificationTarget[]
  onClose: () => void
  onSelectCustomer: (customerId: string) => void
}

export default function BriefingTargetsSheet({ isOpen, title, targets, onClose, onSelectCustomer }: Props) {
  function handleSelect(customerId: string) {
    onSelectCustomer(customerId)
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="briefing-targets-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.22)', backdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="briefing-targets-sheet"
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
              <div className="flex justify-center pt-3.5 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: C.soft }} />
              </div>

              <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold" style={{ color: C.ink }}>{title}</h3>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: C.warn }}
                  >
                    {targets.length}
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: C.brief }}
                >
                  <X size={13} style={{ color: C.note }} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
                {targets.map((t, i) => (
                  <motion.button
                    key={t.id}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    whileTap={{ backgroundColor: C.brief }}
                    onClick={() => handleSelect(t.id)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer"
                    style={{ borderBottom: `1px solid ${C.line}` }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{ background: C.brief }}
                    >
                      <User size={16} style={{ color: C.note }} />
                    </div>
                    <span className="text-[14px] font-medium" style={{ color: C.ink }}>{t.name} 様</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

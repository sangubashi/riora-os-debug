'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, Circle } from 'lucide-react'
import { useMenuStore } from '@/store/useMenuStore'

export default function OptionSelector() {
  const { options, isOptionSelectorOpen, draft, updateDraft, closeOptionSelector } = useMenuStore()
  const linked = draft.linkedOptionIds ?? []

  const toggle = (optId: string) => {
    const next = linked.includes(optId)
      ? linked.filter(id => id !== optId)
      : [...linked, optId]
    updateDraft({ linkedOptionIds: next })
  }

  return (
    <AnimatePresence>
      {isOptionSelectorOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="opt-bg"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeOptionSelector}
            className="fixed inset-0 z-[70]"
            style={{ background: 'rgba(92,64,51,0.22)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-[80] flex justify-center">
            <motion.div
              key="opt-sheet"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              className="w-full max-w-[430px] rounded-t-[28px]"
              style={{
                background: 'linear-gradient(180deg, #FFF9F8 0%, #FFF5F6 100%)',
                border: '1px solid #F3E3E6',
                borderBottom: 'none',
                paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
                boxShadow: '0 -8px 40px rgba(232,145,166,0.12)',
              }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full" style={{ background: '#F3E3E6' }} />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-4">
                <div>
                  <h3 className="text-[16px] font-light" style={{ color: '#5C4033' }}>オプション紐付け</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: '#9A7E74' }}>このメニューに追加できるオプション</p>
                </div>
                <button
                  onClick={closeOptionSelector}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: '#FFF0F2', border: '1px solid #F3E3E6' }}
                >
                  <X size={14} style={{ color: '#9A7E74' }} />
                </button>
              </div>

              {/* Option list */}
              <div className="px-4 flex flex-col gap-2 max-h-[50vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {options.map((opt, i) => {
                  const isLinked = linked.includes(opt.id)
                  return (
                    <motion.button
                      key={opt.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggle(opt.id)}
                      className="flex items-center justify-between p-3.5 rounded-2xl border transition-colors"
                      style={
                        isLinked
                          ? {
                              background: 'rgba(234,145,166,0.08)',
                              borderColor: 'rgba(234,145,166,0.25)',
                              boxShadow: '0 2px 8px rgba(234,145,166,0.08)',
                            }
                          : {
                              background: 'rgba(255,255,255,0.68)',
                              borderColor: '#F3E3E6',
                            }
                      }
                    >
                      <div className="flex items-center gap-3">
                        {isLinked
                          ? <CheckCircle2 size={18} style={{ color: '#EA91A6' }} className="flex-shrink-0" />
                          : <Circle       size={18} style={{ color: '#C8A8B0' }} className="flex-shrink-0" />
                        }
                        <div className="text-left">
                          <p
                            className="text-[13px] font-medium"
                            style={{ color: isLinked ? '#5C4033' : '#9A7E74' }}
                          >
                            {opt.name}
                          </p>
                          <p className="text-[10px]" style={{ color: '#C8A8B0' }}>+{opt.duration}分</p>
                        </div>
                      </div>
                      <span
                        className="text-[13px] tabular-nums"
                        style={{ color: isLinked ? '#EA91A6' : '#9A7E74' }}
                      >
                        ¥{opt.price.toLocaleString('ja-JP')}
                      </span>
                    </motion.button>
                  )
                })}
              </div>

              {/* Done button */}
              <div className="px-4 mt-4">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={closeOptionSelector}
                  className="w-full py-3.5 rounded-full text-[14px] font-medium text-white"
                  style={{ background: 'linear-gradient(135deg, #EA91A6, #F2B6C6)' }}
                >
                  選択完了 ({linked.length}件)
                </motion.button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

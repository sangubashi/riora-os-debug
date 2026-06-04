'use client'
import { useState }  from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, Calendar, Users, ChevronRight } from 'lucide-react'
import { useLineCrmStore, SEGMENTS, type Segment } from '@/store/useLineStore'
import TemplateSheet from './TemplateSheet'

// estimated reach per segment (mock)
const REACH: Record<Segment, number> = {
  '全顧客':       52,
  '1ヶ月以上未来店': 18,
  'VIP顧客':       8,
  'サブスク会員':  14,
  '新規顧客':      12,
}

function calcReach(segments: Segment[]): number {
  if (!segments.length) return 0
  if (segments.includes('全顧客')) return REACH['全顧客']
  const set = new Set<number>()
  segments.forEach(s => { for (let i = 0; i < REACH[s]; i++) set.add(i) })
  return set.size
}

const SCHEDULE_OPTIONS = [
  { value: 'now'      as const, label: '今すぐ配信' },
  { value: 'tomorrow' as const, label: '明日 10:00'  },
  { value: 'custom'   as const, label: '日時を指定'  },
]

export default function BroadcastSheet() {
  const {
    isBroadcastOpen, broadcastBody, broadcastSegments, broadcastSchedule, broadcastCustomAt,
    closeBroadcast, setBroadcastBody, toggleSegment, setBroadcastSchedule, setBroadcastCustomAt,
    openTemplate,
  } = useLineCrmStore()

  const [sent, setSent] = useState(false)
  const reach = calcReach(broadcastSegments)

  const handleSend = () => {
    if (!broadcastBody.trim() || !broadcastSegments.length) return
    setSent(true)
    // TODO: supabase.from('line_campaigns').insert({...})
    setTimeout(() => { setSent(false); closeBroadcast() }, 2000)
  }

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
                maxHeight: '88dvh',
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
                  {reach > 0 && (
                    <span className="text-[11px] bg-[#F5D6DB] text-[#D98292] px-2.5 py-0.5 rounded-full">
                      {reach}名に配信
                    </span>
                  )}
                </div>
                <button onClick={closeBroadcast} className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center">
                  <X size={13} className="text-[#C8A58C]" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ scrollbarWidth: 'none' }}>

                {/* Segment selector */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users size={13} className="text-[#9F7E6C]" />
                    <span className="text-[11px] font-semibold text-[#9F7E6C] tracking-wide">対象セグメント</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SEGMENTS.map(seg => {
                      const isOn = broadcastSegments.includes(seg)
                      return (
                        <motion.button
                          key={seg}
                          whileTap={{ scale: 0.94 }}
                          onClick={() => toggleSegment(seg)}
                          className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                            isOn
                              ? 'bg-[#D98292] text-white border-[#D98292]'
                              : 'bg-white text-[#9F7E6C] border-[#F3E3E6]'
                          }`}
                        >
                          {seg}
                          {isOn && <span className="ml-1 text-[10px]">({REACH[seg]})</span>}
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                {/* Message composer */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-[#9F7E6C] tracking-wide">メッセージ</span>
                    <button
                      onClick={openTemplate}
                      className="flex items-center gap-1 text-[10px] text-[#D98292]"
                    >
                      テンプレから挿入 <ChevronRight size={11} />
                    </button>
                  </div>
                  <textarea
                    value={broadcastBody}
                    onChange={e => setBroadcastBody(e.target.value)}
                    placeholder="配信メッセージを入力…"
                    rows={5}
                    className="w-full bg-[#FFF8F7] border border-[#F3E3E6] rounded-2xl px-4 py-3 text-[#5C4033] placeholder:text-[#C8A58C] outline-none resize-none leading-relaxed"
                    style={{ fontFamily: 'inherit', fontSize: 16 }}
                  />
                  <div className="text-right mt-1">
                    <span className="text-[10px] text-[#C0A8A0]">{broadcastBody.length}字</span>
                  </div>
                </div>

                {/* Schedule */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Calendar size={13} className="text-[#9F7E6C]" />
                    <span className="text-[11px] font-semibold text-[#9F7E6C] tracking-wide">配信日時</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {SCHEDULE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setBroadcastSchedule(opt.value)}
                        className={`py-2 px-3 rounded-xl text-[11px] border transition-colors ${
                          broadcastSchedule === opt.value
                            ? 'bg-[#D98292] text-white border-[#D98292]'
                            : 'bg-white text-[#9F7E6C] border-[#F3E3E6]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {broadcastSchedule === 'custom' && (
                    <motion.input
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      type="datetime-local"
                      value={broadcastCustomAt}
                      onChange={e => setBroadcastCustomAt(e.target.value)}
                      className="mt-2 w-full bg-[#FFF8F7] border border-[#F3E3E6] rounded-xl px-4 py-2 text-[12px] text-[#5C4033] outline-none"
                    />
                  )}
                </div>

              </div>

              {/* Send button */}
              <div className="px-5 pt-3 flex-shrink-0 border-t border-[#F3E3E6]">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSend}
                  disabled={!broadcastBody.trim() || !broadcastSegments.length || sent}
                  className="w-full py-4 rounded-full text-[15px] font-bold flex items-center justify-center gap-2 transition-all"
                  style={{
                    background: sent
                      ? '#34D399'
                      : (!broadcastBody.trim() || !broadcastSegments.length)
                        ? '#F5D6DB'
                        : 'linear-gradient(135deg, #D98292, #F2B6C6)',
                    color: (!broadcastBody.trim() || !broadcastSegments.length) && !sent ? '#C8A58C' : '#fff',
                    boxShadow: sent ? '0 8px 24px rgba(52,211,153,0.35)' : '0 8px 24px rgba(217,130,146,0.35)',
                  }}
                >
                  {sent ? '✓ 配信しました' : reach > 0 ? `${reach}名に配信する` : 'セグメントを選択'}
                </motion.button>
              </div>
            </motion.div>
          </div>

          {/* Template Sheet (z above broadcast sheet) */}
          <TemplateSheet onInsert={(body) => setBroadcastBody(body)} />
        </>
      )}
    </AnimatePresence>
  )
}

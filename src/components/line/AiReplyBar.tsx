'use client'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import type { AiReplySuggestion, AiReplyType } from '@/store/useLineStore'

const TYPE_LABEL: Record<AiReplyType, { label: string; color: string }> = {
  revisit:         { label: '来店促進', color: 'text-[#D98292]'   },
  follow_up:       { label: 'フォロー', color: 'text-[#C9A055]'   },
  cancel_recovery: { label: 'キャンセル対応', color: 'text-rose-500' },
  vip:             { label: 'VIP対応', color: 'text-[#8B6CC0]'   },
}

interface Props {
  suggestions: AiReplySuggestion[]
  onSelect:    (body: string) => void
}

export default function AiReplyBar({ suggestions, onSelect }: Props) {
  if (!suggestions.length) return null

  return (
    <div className="px-4 py-2.5 border-b border-[#F3E3E6] bg-gradient-to-r from-[#FFF8F7] to-[#FEF6FC]">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={11} className="text-[#D98292]" />
        <span className="text-[10px] text-[#9F7E6C] tracking-widest font-medium">AI返信提案</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
        {suggestions.map((s, i) => {
          const meta = TYPE_LABEL[s.type]
          return (
            <motion.button
              key={s.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => onSelect(s.body)}
              className="flex-shrink-0 max-w-[220px] bg-white border border-[#F3E3E6] rounded-2xl px-3 py-2 text-left shadow-sm"
            >
              <span className={`text-[9px] font-semibold tracking-wide ${meta.color}`}>{meta.label}</span>
              <p className="text-[11px] text-[#5C4033] leading-snug mt-0.5 line-clamp-2">{s.body}</p>
              <span className="text-[9px] text-[#D98292] mt-1 inline-block">タップで挿入 →</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

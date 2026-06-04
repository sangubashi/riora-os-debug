'use client'
import { motion } from 'framer-motion'
import type { MessageDirection, MessageStatus } from '@/store/useLineStore'

interface Props {
  direction: MessageDirection
  body:      string
  sentAt:    string
  status:    MessageStatus
  index:     number
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function ChatBubble({ direction, body, sentAt, status, index }: Props) {
  const isSent = direction === 'sent'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={`flex items-end gap-2 mb-2 ${isSent ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* bubble */}
      <div
        className={`
          max-w-[75%] px-4 py-2.5 text-[13.5px] leading-relaxed
          ${isSent
            ? 'bg-gradient-to-br from-[#D98292] to-[#F2B6C6] text-white rounded-2xl rounded-br-[6px]'
            : 'bg-white border border-[#F3E3E6] text-[#5C4033] rounded-2xl rounded-bl-[6px] shadow-sm'
          }
        `}
        style={{ wordBreak: 'break-word' }}
      >
        {body}
      </div>

      {/* meta */}
      <div className={`flex flex-col items-${isSent ? 'end' : 'start'} gap-0.5 flex-shrink-0 pb-0.5`}>
        <span className="text-[10px] text-[#C0A8A0]">{formatTime(sentAt)}</span>
        {isSent && (
          <span className={`text-[9px] ${status === 'read' ? 'text-[#D98292]' : 'text-[#C0A8A0]'}`}>
            {status === 'read' ? '既読' : '送信済'}
          </span>
        )}
      </div>
    </motion.div>
  )
}

'use client'
import { motion } from 'framer-motion'
import { AlertTriangle, Clock } from 'lucide-react'
import { useLineCrmStore } from '@/store/useLineStore'

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 3600)     return `${Math.floor(diff / 60)}分前`
  if (diff < 86400)    return `${Math.floor(diff / 3600)}時間前`
  return `${Math.floor(diff / 86400)}日前`
}

export default function ChatList() {
  const { threads, todayContacts, openThread } = useLineCrmStore()
  const urgentThreads = threads.filter(t => t.isUrgent)
  const totalUnread   = threads.reduce((s, t) => s + t.unreadCount, 0)

  return (
    <div className="flex flex-col pb-24">

      {/* ── 今日の対応が必要 ── */}
      {todayContacts.length > 0 && (
        <div className="mx-4 mt-3 mb-2">
          <div className="bg-gradient-to-r from-[#FFF0F2] to-[#FFF8F7] border border-[#FBCDD4] rounded-2xl p-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle size={12} className="text-rose-500" />
              <span className="text-[10px] font-semibold text-rose-500 tracking-wide">今日の対応が必要</span>
            </div>
            <div className="flex flex-col gap-2">
              {todayContacts.map((c, i) => (
                <motion.button
                  key={c.customerId}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    const thread = threads.find(t => t.id === c.threadId)
                    if (thread) openThread(thread)
                  }}
                  className="flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: c.urgency === 'high' ? '#F56E8B' : '#E7C68B' }}
                    />
                    <div>
                      <span className="text-[12px] font-medium text-[#5C4033]">{c.customerName} 様</span>
                      <p className="text-[10px] text-[#9F7E6C] leading-snug">{c.reason}</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-[#D98292] flex-shrink-0">対応する →</span>
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Unread summary ── */}
      {totalUnread > 0 && (
        <div className="mx-4 mb-1 flex items-center gap-1.5">
          <Clock size={11} className="text-[#C8A58C]" />
          <span className="text-[11px] text-[#9F7E6C]">未返信 <strong className="text-[#D98292]">{totalUnread}件</strong></span>
        </div>
      )}

      {/* ── Thread list ── */}
      <div className="flex flex-col">
        {threads.map((thread, i) => (
          <motion.button
            key={thread.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => openThread(thread)}
            className={`
              flex items-center gap-3 px-4 py-3.5 border-b border-[#F3E3E6] text-left
              ${thread.unreadCount > 0 ? 'bg-white' : 'bg-transparent'}
              active:bg-[#FFF8F7]
            `}
          >
            {/* Avatar */}
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-white text-[15px] font-medium flex-shrink-0 relative"
              style={{
                background: thread.isUrgent
                  ? 'linear-gradient(135deg, #F56E8B, #F2B6C6)'
                  : 'linear-gradient(135deg, #D98292, #F2B6C6)',
              }}
            >
              {thread.customerName.slice(-1)}
              {thread.unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#F56E8B] rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                  {thread.unreadCount}
                </span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-[14px] truncate ${thread.unreadCount > 0 ? 'font-semibold text-[#5C4033]' : 'font-normal text-[#5C4033]'}`}>
                  {thread.customerName} 様
                </span>
                {thread.isUrgent && (
                  <AlertTriangle size={11} className="text-rose-400 flex-shrink-0" />
                )}
              </div>
              <p className={`text-[12px] truncate ${thread.unreadCount > 0 ? 'text-[#5C4033]' : 'text-[#9F7E6C]'}`}>
                {thread.lastMessage}
              </p>
            </div>

            {/* Meta */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-[10px] text-[#C0A8A0]">{timeAgo(thread.lastMessageAt)}</span>
              {thread.tags.slice(0, 1).map(tag => (
                <span key={tag} className="text-[9px] bg-[#F5D6DB] text-[#D98292] px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

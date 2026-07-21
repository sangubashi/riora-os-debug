'use client'
/**
 * NotificationSheet.tsx — アプリ内通知v1「通知センター」(ボトムシート)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §2 準拠。
 * 「事実・祝福・気遣い」のみを表示する。スコア・ランク・VIP・数字競争は禁止
 * (Riora OS v1 再設計方針)。煽り色(赤)は使わず落ち着いたトーンで表示する
 * (LINE未返信の赤バッジとは意図的に色を分けている)。
 *
 * 既読状態はメモリ上のみで管理し、DBには保存しない
 * (notificationsテーブルを作らない設計のため)。
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Bell, Copy, Check } from 'lucide-react'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import { generateCelebrationCards } from '@/lib/notifications/generateCard'
import type { StaffNotification } from '@/types/notifications'

const COPYABLE_KINDS = new Set<StaffNotification['kind']>(['birthday', 'anniversary_visit'])

interface Props {
  isOpen:  boolean
  onClose: () => void
  onSelectCustomer?: (customerId: string) => void
}

function timeContextLabel(kind: StaffNotification['kind']): string {
  switch (kind) {
    case 'birthday':             return '祝福'
    case 'anniversary_visit':    return '祝福'
    case 'wedding':               return '祝福'
    case 'homecare_usage_guide': return '気遣い'
    case 'homecare_checkin':     return '気遣い'
    case 'homecare_replenish':   return '気遣い'
    case 'no_visit_60':          return '事実'
    case 'skin_improving':       return '事実'
    case 'visit_reminder':       return '準備'
    case 'new_reservation':      return '実務'
    case 'churn_risk_admin':     return '管理者'
    case 'approval_pending_admin': return '管理者'
  }
}

export default function NotificationSheet({ isOpen, onClose, onSelectCustomer }: Props) {
  const { notifications, isLoading, error, readIds, fetchNotifications, markRead } = useNotificationsStore()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) fetchNotifications()
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(n: StaffNotification) {
    markRead(n.id)
    if (n.customerId) onSelectCustomer?.(n.customerId)
    onClose()
  }

  // 誕生日・記念日はLINEへ手動送信する運用のため、テンプレ全文をクリップボードへコピーする
  // だけに留める(自動送信は行わない)。memorySoft(パターンB)は通知APIが未対応のため
  // 常にnull=パターンA固定で生成する。
  function handleCopy(e: React.MouseEvent, n: StaffNotification) {
    e.stopPropagation()
    const [card] = generateCelebrationCards([n], null)
    const text = card?.fullText?.patternA
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedId(n.id)
    setTimeout(() => setCopiedId((cur) => (cur === n.id ? null : cur)), 2000)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="notif-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.22)', backdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="notif-sheet"
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
                <div className="w-10 h-1 rounded-full bg-[#F5E6E8]" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-b border-[#F5E6E8] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Bell size={16} style={{ color: '#D98292' }} />
                  <h3 className="text-[15px] font-semibold" style={{ color: '#5C4033' }}>通知</h3>
                  {notifications.length > 0 && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ background: '#D98292' }}
                    >
                      {notifications.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
                >
                  <X size={13} style={{ color: '#9F7E6C' }} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
                {isLoading ? (
                  <div className="flex justify-center py-10">
                    <div className="w-6 h-6 rounded-full border-2 border-[#D98292] border-t-transparent animate-spin" />
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <p className="text-[13px]" style={{ color: '#C0392B' }}>通知の取得に失敗しました</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Bell size={32} style={{ color: '#C8B8C0' }} />
                    <p className="text-[13px]" style={{ color: '#9E8090' }}>今は通知がありません</p>
                  </div>
                ) : (
                  notifications.map((n, i) => {
                    const isRead = readIds.has(n.id)
                    const hasContraindication = n.kind === 'visit_reminder' && n.detail?.some((d) => d.includes('（禁忌）'))
                    const isCopyable = COPYABLE_KINDS.has(n.kind)
                    const isCopied = copiedId === n.id
                    return (
                      <motion.div
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        whileTap={{ backgroundColor: '#FFF5F8' }}
                        onClick={() => handleSelect(n)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(n) }}
                        className="w-full flex items-start gap-3 px-5 py-4 border-b border-[#F5E6E8] text-left cursor-pointer"
                        style={{ opacity: isRead ? 0.55 : 1 }}
                      >
                        <div
                          className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
                          style={{ background: '#FDF5F7', fontSize: '16px' }}
                        >
                          {n.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#F0F8F4', color: '#30806A' }}>
                              {timeContextLabel(n.kind)}
                            </span>
                          </div>
                          <p className={`text-[13px] font-medium ${n.detail ? '' : 'truncate'}`} style={{ color: '#5C4033' }}>
                            {n.title}
                          </p>
                          {n.detail && n.detail.length > 0 && (
                            <div className="flex flex-col gap-0.5 mt-1.5">
                              {n.detail.map((line, di) => (
                                <p
                                  key={di}
                                  className="text-[11px] leading-snug"
                                  style={{ color: line.includes('（禁忌）') ? '#C0392B' : '#9F7E6C', fontWeight: line.includes('（禁忌）') ? 700 : 400 }}
                                >
                                  {line}
                                </p>
                              ))}
                            </div>
                          )}
                          {isCopyable && (
                            <button
                              onClick={(e) => handleCopy(e, n)}
                              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                              style={{
                                background: isCopied ? '#EAF6EF' : '#FDF0F3',
                                color:      isCopied ? '#2F8F5B' : '#B06070',
                              }}
                            >
                              {isCopied ? <Check size={12} /> : <Copy size={12} />}
                              {isCopied ? 'コピーしました' : 'LINE文面をコピー'}
                            </button>
                          )}
                        </div>
                        {!isRead && (
                          <div
                            className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5"
                            style={{ background: hasContraindication ? '#C0392B' : '#D98292' }}
                          />
                        )}
                      </motion.div>
                    )
                  })
                )}
              </div>

              <div className="flex-shrink-0 px-5 py-3 text-center" style={{ borderTop: '1px solid #F5E6E8' }}>
                <p className="text-[10px]" style={{ color: '#C8B0B0' }}>
                  祝福・気遣い・事実のみをお知らせします
                </p>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

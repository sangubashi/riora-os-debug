'use client'
/**
 * MemoScreen — 「メモ」タブ
 *
 * 音声メモをここに統合。本日の予約から顧客を選び、
 * 録音 → 保存 → AI要約 の流れに入る。
 * (Riora OS v1.0 再設計書 準拠。「ログ」ではなく「メモ」表記で統一)
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Mic } from 'lucide-react'
import Image from 'next/image'
import AppBottomNav from './AppBottomNav'
import VoiceMemoSection from '@/components/customer/VoiceMemoSection'
import { useHomeStore } from '@/store/useHomeStore'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from 'sonner'

function formatTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(11, 16) }
}

export default function MemoScreen() {
  const { reservations, isLoading, fetchTodayReservations } = useHomeStore()
  const { session, initialized } = useAuthStore()
  const fetchedRef = useRef(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (fetchedRef.current || !initialized) return
    fetchedRef.current = true
    const uid = session?.user?.id ?? null
    const role = (
      (session?.user?.app_metadata?.role  as 'owner' | 'staff' | null) ??
      (session?.user?.user_metadata?.role as 'owner' | 'staff' | null) ??
      'staff'
    )
    if (uid) fetchTodayReservations(role, uid)
  }, [initialized, session]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = reservations.find(r => r.id === selectedId) ?? null
  const staffId  = session?.user?.id ?? null

  return (
    <div
      className="h-dvh flex flex-col overflow-hidden"
      style={{
        width: '100%',
        maxWidth: '430px',
        marginLeft: 'auto',
        marginRight: 'auto',
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      {/* ── ヘッダー ── */}
      <div
        className="flex-shrink-0 px-5"
        style={{
          paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 12px))',
          paddingBottom: '14px',
          background: 'rgba(253,247,248,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #F5E6E8',
        }}
      >
        {selected ? (
          <button
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1 bg-transparent border-none cursor-pointer text-[13px]"
            style={{ color: '#C8A58C' }}
          >
            <ChevronLeft size={16} strokeWidth={2} />戻る
          </button>
        ) : (
          <>
            <p className="text-[10px] font-medium tracking-[0.32em] mb-0.5" style={{ color: '#C8A8B0' }}>
              SALON RIORA
            </p>
            <h1 className="text-[24px] font-light leading-tight" style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}>Notes</h1>
            <p className="text-[13px] mt-0.5" style={{ color: '#9E8090' }}>
              録音 → 保存 → AI要約
            </p>
          </>
        )}
      </div>

      {/* ── コンテンツ ── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(68px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div
              key="voice"
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.18 }}
            >
              <div className="bg-white rounded-[20px] border border-[#F5E6E8] px-4 py-3 mb-3 flex items-center justify-between">
                <span className="text-[14px] font-semibold" style={{ color: '#4A2C2A' }}>
                  {selected.brain_customer?.name ?? '顧客'} 様
                </span>
                <span className="text-[11px]" style={{ color: '#9E8090' }}>
                  {formatTime(selected.scheduled_at)}
                </span>
              </div>
              <VoiceMemoSection
                customerId={selected.brain_customer_id!}
                staffId={staffId}
                reservationId={selected.id}
                onSaved={() => toast.success('メモを保存しました 🌸', { duration: 2000 })}
              />
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {isLoading && (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i}
                      className="bg-white rounded-[20px] border border-[#F5E6E8] h-[64px] animate-pulse"
                      style={{ opacity: 1 - i * 0.1 }}
                    />
                  ))}
                </div>
              )}

              {!isLoading && reservations.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Image src="/assets/rio-kuma.png" alt="" width={56} height={56}
                    className="object-contain opacity-40" />
                  <p className="text-[13px]" style={{ color: '#9E8090' }}>
                    本日の予約はありません
                  </p>
                </div>
              )}

              {!isLoading && reservations.map((r, i) => (
                <motion.button
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedId(r.id)}
                  disabled={!r.brain_customer_id}
                  className="w-full text-left bg-white rounded-[20px] border border-[#F5E6E8] flex items-center gap-3 px-4 py-3.5 mb-3"
                  style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)', opacity: r.brain_customer_id ? 1 : 0.5 }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #F0F5FA 0%, #E8F0F8 100%)' }}
                  >
                    <Mic size={16} color="#4878A8" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: '#4A2C2A' }}>
                      {r.brain_customer?.name ?? '（顧客未紐付け）'} 様
                    </p>
                    <p className="text-[11px]" style={{ color: '#9E8090' }}>
                      {formatTime(r.scheduled_at)}　{r.menu}
                    </p>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AppBottomNav />
    </div>
  )
}

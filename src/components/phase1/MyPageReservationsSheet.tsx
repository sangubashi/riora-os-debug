'use client'
/**
 * MyPageReservationsSheet — My Page「今週の予約」タップ時の詳細(今日/明日)
 *
 * 既存データのみを利用する(新規API・DB変更・分析ロジック追加は行わない):
 *
 *   今日: useHomeStore(GET /api/home/reservations)が返す構造化データをそのまま使う。
 *     scheduled_at(時刻)・brain_customer.name(顧客名)・menu(メニュー名)・
 *     brain_customer.last_visit_date(前回来店日数の算出元)が揃っているため、
 *     時刻の昇順に並べてすべて表示できる。
 *
 *   明日: useNotificationsStore(GET /api/notifications)のvisit_reminder通知しか
 *     データが無い。この通知のtitleには顧客名・来店フレーズ(「◯日ぶりのご来店」等)は
 *     含まれるが、時刻・メニュー名は一切含まれていない(detectVisitReminders.tsの
 *     生成元を確認済み)。そのため明日分は時刻・メニューを表示できない(取得不可・
 *     新規実装はしない)。表示順もAPIが返した順のまま(時刻データが無く並び替え不能)。
 */
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { ReservationWithBrainCustomer } from '@/types/database'
import type { StaffNotification } from '@/types/notifications'

interface Props {
  isOpen:                boolean
  onClose:                () => void
  todayReservations:      ReservationWithBrainCustomer[]
  tomorrowNotifications:  StaffNotification[]
}

function formatJstTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 前回来店からの日数。既存のdetectVisitReminders.ts(daysSinceLastVisit)と同じ算出式を
 *  この表示専用に踏襲するのみで、新しい計算ロジックは導入しない。 */
function daysSinceLastVisit(scheduledAt: string, lastVisitDate: string | null | undefined): number | null {
  if (!lastVisitDate) return null
  const diff = startOfDay(new Date(scheduledAt)).getTime() - startOfDay(new Date(lastVisitDate)).getTime()
  return Math.round(diff / 86_400_000)
}

/** 明日の通知titleから、顧客名以外の付随情報(来店フレーズ)だけを取り出す。時刻・メニューは
 *  この文字列自体に含まれていないため取得できない(既存文字列の該当部分を抜き出すのみで、
 *  新しい解析ロジックの追加ではない)。 */
function extractVisitPhrase(title: string): string | null {
  const m = title.match(/（(.+)）/)
  if (!m) return null
  return m[1].replace(/／担当：.+$/, '')
}

function sortByScheduledAt(rows: ReservationWithBrainCustomer[]): ReservationWithBrainCustomer[] {
  return rows.slice().sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
}

export default function MyPageReservationsSheet({ isOpen, onClose, todayReservations, tomorrowNotifications }: Props) {
  const todaySorted = sortByScheduledAt(todayReservations)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="mypage-resv-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.22)', backdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="mypage-resv-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              className="w-full max-w-[430px] pointer-events-auto rounded-t-[32px] flex flex-col"
              style={{
                maxHeight: '78dvh',
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
                <h3 className="text-[15px] font-semibold text-salon-brown">今週の予約</h3>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
                >
                  <X size={13} className="text-salon-brown-sub" />
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto no-scrollbar px-5 py-4"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                {/* ── 今日 ── */}
                <p className="text-[11px] font-bold mb-2" style={{ color: '#D14F86' }}>今日</p>
                {todaySorted.length === 0 ? (
                  <p className="text-[12px] mb-4" style={{ color: '#C8A8B0' }}>本日の予約はありません</p>
                ) : (
                  <div className="flex flex-col gap-2 mb-4">
                    {todaySorted.map((r) => {
                      const days = daysSinceLastVisit(r.scheduled_at, r.brain_customer?.last_visit_date)
                      return (
                        <div
                          key={r.id}
                          className="flex items-start gap-3 rounded-[14px] px-3.5 py-3"
                          style={{ background: '#FBF6F7' }}
                        >
                          <span
                            className="text-[14px] font-bold tabular-nums flex-shrink-0"
                            style={{ color: '#5C4033', fontFamily: 'Inter, sans-serif', minWidth: '46px' }}
                          >
                            {formatJstTime(r.scheduled_at)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold" style={{ color: '#5C4033' }}>
                              {r.brain_customer.name} 様
                            </p>
                            <p className="text-[11px] mt-0.5 leading-snug" style={{ color: '#9E8090' }}>
                              {r.menu}
                              {days !== null && <span>　・{days}日ぶり</span>}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── 明日 ── */}
                <p className="text-[11px] font-bold mb-2" style={{ color: '#B98CC0' }}>明日</p>
                {tomorrowNotifications.length === 0 ? (
                  <p className="text-[12px]" style={{ color: '#C8A8B0' }}>明日の予約はありません</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tomorrowNotifications.map((n) => {
                      const phrase = extractVisitPhrase(n.title)
                      return (
                        <div
                          key={n.id}
                          className="flex items-start gap-3 rounded-[14px] px-3.5 py-3"
                          style={{ background: '#FBF6F7' }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold" style={{ color: '#5C4033' }}>
                              {n.customerName ?? '—'} 様
                            </p>
                            {phrase && (
                              <p className="text-[11px] mt-0.5 leading-snug" style={{ color: '#9E8090' }}>{phrase}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-[10px] mt-1" style={{ color: '#C8A8B0' }}>
                      ※明日分は時刻・メニュー情報を取得できないため表示していません
                    </p>
                  </div>
                )}
              </div>

              <div style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }} />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

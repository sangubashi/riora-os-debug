'use client'
/**
 * TodayBriefingCard — 今日タブ「来店前30秒ブリーフィング」
 *
 * デザイン参照: docs/architecture/Riora_ブリーフィング画面イメージ.html
 * 配色・レイアウトは参照HTMLに準拠（アプリ既存のピンク系トーンとは別系統として、
 * この画面のみで採用する暖色系パレット）。データはすべて GET /api/today-briefing 経由の実データ。
 *
 * 表示順（PHASE TODAY-UX-1）: 完了済み（過去予約・縮小） → 次のお客様（大型・主役）
 *        → 今日、気をつけること（①禁忌 ②触れないこと ③今日の焦点・最大3行）
 *        → くわしく見る（折りたたみ） → このあとの予約（未来予約・通常表示）
 *
 * 過去/未来の振り分けは表示専用のクライアント側判定（scheduledAt と現在時刻の比較）であり、
 * APIレスポンス（TodayBriefingResponse）のデータ構造は変更していない。
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import { useTodayBriefingStore } from '@/store/useTodayBriefingStore'
import type { TodayBriefingCaution } from '@/types/todayBriefing'

// 全顧客共通のアバター（リオくま）。顧客ごとの写真切替は行わない。
const AVATAR_SRC = '/assets/rio-kuma.png'

const C = {
  bg:    '#F8F1F3',
  card:  '#FFFFFF',
  soft:  '#F5E6E8',
  gold:  '#C8A58C',
  ink:   '#5C4033',
  ink2:  '#9C8478',
  line:  '#EFE2E4',
  warn:  '#B0524E',
  note:  '#B98C6E',
  brief: '#FBF4F0',
}

const CAUTION_ICON: Record<TodayBriefingCaution['kind'], string> = {
  contraindication: '⚠',
  ng_topic:         '🤫',
  focus:            '🎯',
}

function formatTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(11, 16) }
}

function formatMonthDay(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// CUSTOMER_BRIEFING_IMPLEMENT_2: 前回来店日の表示専用（YYYY/MM/DD）。既存の
// formatMonthDay（くわしく見る内の「前回(M/D)」表記）はそのまま残し、変更しない。
function formatFullDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

// 「あと◯分」をクライアント側で再計算（APIレスポンスは開いた瞬間のスナップショットのため）
function computeMinutesUntil(scheduledAtIso: string): number {
  const diffMs = new Date(scheduledAtIso).getTime() - Date.now()
  return Math.max(0, Math.round(diffMs / 60000))
}

// 完了済み予約: 初期表示は最大3件までとし、主役の「次のお客様」カードが
// 初期スクロール位置で必ず見えるようにする（表示専用の圧縮・データは変更しない）
const PAST_VISIBLE_LIMIT = 3

interface Props {
  onSelectCustomer: (reservationId: string) => void
}

export default function TodayBriefingCard({ onSelectCustomer }: Props) {
  const { briefing, isLoading, fetchTodayBriefing } = useTodayBriefingStore()
  const [detailOpen, setDetailOpen] = useState(false)
  const [pastExpanded, setPastExpanded] = useState(false)
  const [minutesUntil, setMinutesUntil] = useState<number | null>(null)

  useEffect(() => { fetchTodayBriefing() }, [fetchTodayBriefing])

  // 次のお客様までの分数を1分ごとに再計算
  const nextScheduledAt = briefing?.next?.scheduledAt
  useEffect(() => {
    if (!nextScheduledAt) { setMinutesUntil(null); return }
    setMinutesUntil(computeMinutesUntil(nextScheduledAt))
    const id = setInterval(() => setMinutesUntil(computeMinutesUntil(nextScheduledAt)), 60_000)
    return () => clearInterval(id)
  }, [nextScheduledAt])

  if (isLoading && !briefing) {
    return (
      <div className="mx-4 mt-3 rounded-2xl h-[220px] animate-pulse" style={{ background: C.soft }} />
    )
  }

  if (!briefing?.next) {
    return (
      <div
        className="mx-4 mt-3 rounded-2xl px-4 py-6 text-center"
        style={{ background: C.card, border: `1px solid ${C.line}` }}
      >
        <p className="text-[13px]" style={{ color: C.ink2 }}>本日の予約はありません</p>
      </div>
    )
  }

  const { next, cautions, detail, upcoming } = briefing

  // CUSTOMER_BRIEFING_IMPLEMENT_3: 禁忌事項は既存の cautions（kind='contraindication'）
  // をそのまま表示専用に絞り込むだけで、APIレスポンス・データ構造は変更しない。
  const contraindicationText = cautions
    .filter(c => c.kind === 'contraindication')
    .map(c => c.text)
    .join('、')

  // UI表示専用の過去/未来振り分け（データ構造・APIは変更しない。scheduledAtの
  // クライアント側比較のみ）。upcomingは元々scheduled_at昇順のため、過去分は
  // 常に未来分より前に来る＝フィルタしても順序は保たれる。
  const nowMs     = Date.now()
  const pastList  = upcoming.filter(u => new Date(u.scheduledAt).getTime() <  nowMs)
  // このあとの予約: scheduledAt昇順であることをコンポーネント側でも明示的に保証する
  // （表示専用の防御的ソート。APIレスポンスの並び順・データ構造は変更しない）
  const futureList = upcoming
    .filter(u => new Date(u.scheduledAt).getTime() >= nowMs)
    .slice()
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

  const visiblePast    = pastExpanded ? pastList : pastList.slice(0, PAST_VISIBLE_LIMIT)
  const hiddenPastCount = pastList.length - visiblePast.length

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-4 mt-3 rounded-2xl p-4"
      style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: '0 8px 30px rgba(92,64,51,0.08)' }}
    >
      {/* ── A. 過去予約（縮小・完了済み・初期表示は最大3件）── */}
      {pastList.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] tracking-[0.08em] mb-1.5" style={{ color: C.ink2 }}>
            完了済み{pastList.length > PAST_VISIBLE_LIMIT ? `（${pastList.length}件）` : ''}
          </p>
          {visiblePast.map(u => (
            <button
              key={u.reservationId}
              onClick={() => onSelectCustomer(u.reservationId)}
              className="w-full flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-[8px] mb-1"
              style={{ background: '#FAF6F5', opacity: 0.6 }}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#E7CFC0' }}>
                  <Image src={AVATAR_SRC} alt="" width={20} height={20} className="object-contain" />
                </span>
                <span className="truncate" style={{ color: C.ink2 }}>{u.customerName} 様</span>
              </span>
              <span className="flex-shrink-0 ml-2" style={{ color: C.ink2, fontFamily: 'Inter, sans-serif' }}>
                {formatTime(u.scheduledAt)}
              </span>
            </button>
          ))}
          {hiddenPastCount > 0 && (
            <button
              onClick={() => setPastExpanded(true)}
              className="w-full text-center text-[10px] py-1"
              style={{ color: C.ink2 }}
            >
              他{hiddenPastCount}件を見る
            </button>
          )}
          {pastExpanded && pastList.length > PAST_VISIBLE_LIMIT && (
            <button
              onClick={() => setPastExpanded(false)}
              className="w-full text-center text-[10px] py-1"
              style={{ color: C.ink2 }}
            >
              閉じる
            </button>
          )}
        </div>
      )}

      {/* ── B. 次のお客様（大型表示・主役）── */}
      <div
        className="rounded-2xl p-4 mb-1"
        style={{ background: 'linear-gradient(135deg, #FBF0E8 0%, #FFFFFF 100%)', border: `1.5px solid ${C.gold}` }}
      >
        <p
          className="text-[11px] tracking-[0.1em] text-center mb-3"
          style={{ color: C.gold, fontFamily: 'Inter, sans-serif' }}
        >
          次のお客様まで あと {minutesUntil ?? next.minutesUntil}分
        </p>
        <button
          onClick={() => onSelectCustomer(next.reservationId)}
          className="w-full flex items-center gap-4 text-left"
        >
          <div
            className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ background: '#E7CFC0' }}
          >
            <Image src={AVATAR_SRC} alt="" width={64} height={64} className="object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[20px] font-bold truncate" style={{ color: C.ink }}>
              {next.customerName} 様
            </p>
            <p className="text-[12px] mt-1" style={{ color: C.ink2, fontFamily: 'Inter, sans-serif' }}>
              {next.visitCount}回目 ・ {next.customerType}
              {next.staffName && <> ・ 担当 {next.staffName}</>}
            </p>
          </div>
          <span
            className="text-[13px] font-semibold text-white rounded-full px-3 py-1.5 flex-shrink-0"
            style={{ background: C.gold, fontFamily: 'Inter, sans-serif' }}
          >
            {formatTime(next.scheduledAt)}
          </span>
          <ChevronRight size={16} className="flex-shrink-0" style={{ color: C.ink2 }} />
        </button>
        {(next.reservationMenu || detail.lastVisitDate || detail.lastVisitMenu || contraindicationText
          || detail.handoverNote || detail.recentChange || detail.nextFocus.length > 0) && (
          <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px dashed ${C.line}` }}>
            {next.reservationMenu && (
              <p className="text-[12px]" style={{ color: C.ink }}>
                予約メニュー：{next.reservationMenu}
              </p>
            )}
            {detail.lastVisitDate && (
              <p className="text-[12px] mt-1.5" style={{ color: C.ink }}>
                前回来店：{formatFullDate(detail.lastVisitDate)}
              </p>
            )}
            {detail.lastVisitMenu && (
              <p className="text-[12px] mt-1.5" style={{ color: C.ink }}>
                前回施術：{detail.lastVisitMenu}
              </p>
            )}
            {contraindicationText && (
              <p className="text-[12px] mt-1.5" style={{ color: C.warn }}>
                注意：{contraindicationText}
              </p>
            )}
            {detail.handoverNote && (
              <p className="text-[12px] mt-1.5" style={{ color: C.ink }}>
                引継ぎ：{detail.handoverNote}
              </p>
            )}
            {detail.recentChange && (
              <p className="text-[12px] mt-1.5" style={{ color: C.ink }}>
                最近の変化：{detail.recentChange}
              </p>
            )}
            {detail.nextFocus.length > 0 && (
              <div className="text-[12px] mt-1.5" style={{ color: C.ink }}>
                今回意識すること：
                {detail.nextFocus.map((f, i) => (
                  <p key={i} className="mt-0.5">・{f}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 今日、気をつけること（最大3行・優先順固定）── */}
      {cautions.length > 0 && (
        <div className="rounded-[14px] px-4 py-3.5 mt-3.5" style={{ background: C.brief }}>
          <p className="text-[10px] tracking-[0.1em] mb-2.5" style={{ color: C.note, fontFamily: 'Inter, sans-serif' }}>
            今日、気をつけること
          </p>
          {cautions.map((c, i) => {
            const isWarn = c.kind !== 'focus'
            return (
              <div key={i} className="flex items-start gap-2.5 py-1.5 text-[14px]">
                <span className="w-5 text-center flex-shrink-0" style={{ color: isWarn ? C.warn : C.ink }}>
                  {CAUTION_ICON[c.kind]}
                </span>
                <span style={{ color: isWarn ? C.warn : C.ink }}>{c.text}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── くわしく見る（折りたたみ）── */}
      <div className="rounded-xl mt-1.5" style={{ border: `1px solid ${C.line}` }}>
        <button
          onClick={() => setDetailOpen(v => !v)}
          className="w-full flex items-center justify-between px-3.5 py-3 text-[12px]"
          style={{ color: C.ink2 }}
        >
          <span>くわしく見る（前回・履歴・AIまとめ）</span>
          <motion.span animate={{ rotate: detailOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={14} />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {detailOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="px-3.5 pb-3.5 text-[12px] leading-[1.8]" style={{ color: '#6E5547' }}>
                {(detail.lastVisitDate || detail.lastVisitMenu) && (
                  <div className="pt-1.5" style={{ borderTop: `1px dashed ${C.line}` }}>
                    <b style={{ color: C.ink }}>
                      前回{detail.lastVisitDate ? `(${formatMonthDay(detail.lastVisitDate)})` : ''}
                    </b>
                    ：{detail.lastVisitMenu ?? '記録なし'}
                  </div>
                )}
                {next.reservationNotes && (
                  <div className="pt-1.5 mt-1.5" style={{ borderTop: `1px dashed ${C.line}` }}>
                    <b style={{ color: C.ink }}>予約備考</b>：{next.reservationNotes}
                  </div>
                )}
                {detail.memoryNote && (
                  <div className="pt-1.5 mt-1.5" style={{ borderTop: `1px dashed ${C.line}` }}>
                    <b style={{ color: C.ink }}>覚えておくこと</b>：{detail.memoryNote}
                  </div>
                )}
                {detail.aiSummary && (
                  <div className="pt-1.5 mt-1.5" style={{ borderTop: `1px dashed ${C.line}` }}>
                    <b style={{ color: C.ink }}>AIまとめ</b>：{detail.aiSummary}
                  </div>
                )}
                <button
                  onClick={() => onSelectCustomer(next.reservationId)}
                  className="pt-1.5 mt-1.5 text-left w-full"
                  style={{ borderTop: `1px dashed ${C.line}` }}
                >
                  <b style={{ color: C.ink }}>AI Timeline を開く →</b>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── C. それ以降の未来予約（通常表示）── */}
      {futureList.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] mb-2" style={{ color: C.ink2 }}>このあとの予約</p>
          {futureList.map(u => (
            <button
              key={u.reservationId}
              onClick={() => onSelectCustomer(u.reservationId)}
              className="w-full flex items-center justify-between text-[13px] px-3 py-2.5 rounded-[10px] mb-1.5"
              style={{ background: '#FFFDFD', border: `1px solid ${C.line}` }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#E7CFC0' }}>
                  <Image src={AVATAR_SRC} alt="" width={24} height={24} className="object-contain" />
                </span>
                <span className="truncate" style={{ color: C.ink }}>{u.customerName} 様 ・ {u.visitCount}回目</span>
              </span>
              <span className="flex-shrink-0 ml-2" style={{ color: C.gold, fontFamily: 'Inter, sans-serif' }}>{formatTime(u.scheduledAt)}</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-[10px] text-center mt-3.5" style={{ color: C.ink2 }}>
        まず3行。深く知りたいときだけ開く。
      </p>
    </motion.div>
  )
}

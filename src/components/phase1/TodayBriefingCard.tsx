'use client'
/**
 * TodayBriefingCard — 今日タブ「来店前30秒ブリーフィング」
 *
 * デザイン参照: docs/architecture/Riora_ブリーフィング画面イメージ.html
 * 配色・レイアウトは参照HTMLに準拠（アプリ既存のピンク系トーンとは別系統として、
 * この画面のみで採用する暖色系パレット）。データはすべて GET /api/today-briefing 経由の実データ。
 *
 * 表示順: 次のお客様 → 今日、気をつけること（①禁忌 ②触れないこと ③今日の焦点・最大3行）
 *        → くわしく見る（折りたたみ） → このあとの予約
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useTodayBriefingStore } from '@/store/useTodayBriefingStore'
import type { TodayBriefingCaution } from '@/types/todayBriefing'

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

interface Props {
  onSelectCustomer: (reservationId: string) => void
}

export default function TodayBriefingCard({ onSelectCustomer }: Props) {
  const { briefing, isLoading, fetchTodayBriefing } = useTodayBriefingStore()
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => { fetchTodayBriefing() }, [fetchTodayBriefing])

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

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-4 mt-3 rounded-2xl p-4"
      style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: '0 8px 30px rgba(92,64,51,0.08)' }}
    >
      {/* ── 次のお客様まで あとN分 ── */}
      <p
        className="text-[11px] tracking-[0.1em] text-center mb-3"
        style={{ color: C.gold, fontFamily: 'Inter, sans-serif' }}
      >
        次のお客様まで あと {next.minutesUntil}分
      </p>

      {/* ── 次のお客様 ── */}
      <button
        onClick={() => onSelectCustomer(next.reservationId)}
        className="w-full flex items-center gap-3 pb-3 text-left"
        style={{ borderBottom: `1px solid ${C.line}` }}
      >
        <div className="w-11 h-11 rounded-full flex-shrink-0" style={{ background: '#E7CFC0' }} />
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-semibold truncate" style={{ color: C.ink }}>
            {next.customerName} 様
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: C.ink2, fontFamily: 'Inter, sans-serif' }}>
            {next.visitCount}回目 ・ {next.customerType}
            {next.staffName && <> ・ 担当 {next.staffName}</>}
          </p>
        </div>
        <span
          className="text-[11px] text-white rounded-full px-2.5 py-1 flex-shrink-0"
          style={{ background: C.gold, fontFamily: 'Inter, sans-serif' }}
        >
          {formatTime(next.scheduledAt)}
        </span>
      </button>

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

      {/* ── このあとの予約 ── */}
      {upcoming.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] mb-2" style={{ color: C.ink2 }}>このあとの予約</p>
          {upcoming.map(u => (
            <button
              key={u.reservationId}
              onClick={() => onSelectCustomer(u.reservationId)}
              className="w-full flex items-center justify-between text-[13px] px-3 py-2.5 rounded-[10px] mb-1.5"
              style={{ background: '#FFFDFD', border: `1px solid ${C.line}` }}
            >
              <span style={{ color: C.ink }}>{u.customerName} 様 ・ {u.visitCount}回目</span>
              <span style={{ color: C.gold, fontFamily: 'Inter, sans-serif' }}>{formatTime(u.scheduledAt)}</span>
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

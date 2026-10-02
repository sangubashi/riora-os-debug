'use client'
/**
 * ReservationRescheduleDialog.tsx — `/karte`「本日の予約」の「別日に予約」(2026-10-02)。
 *
 * スタッフが日付と時間を選び、予約を別の日時へ移す。移した結果(元の予約は「変更」へ、新しい日時の
 * 予約を作成)の処理は親が担い、このコンポーネントは入力と表示、二重押下防止(busy中は全ボタン
 * disabled・背景タップでも閉じない)のみを担う。window.confirm等のブラウザダイアログは使わない
 * (iPad Safariでのフリーズ回避のため)。
 */
import { useState } from 'react'
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'
import { formatJstMonthDayTime, RESCHEDULE_MINUTE_STEP, splitJstDateTime, todayJstDate } from '@/lib/reservations/reschedule'

interface Props {
  customerName:  string
  /** 元の予約の日時(ISO)。 */
  originalAt:    string
  menuName:      string
  busy:          boolean
  error:         string | null
  /** 担当スタッフの別の予約と時間が重なる場合に親が立てる(「重なっても予約する」を出す)。 */
  overlapWarning: boolean
  onSubmit:      (input: { date: string; time: string; allowOverlap: boolean }) => void
  onClose:       () => void
}

export default function ReservationRescheduleDialog({
  customerName, originalAt, menuName, busy, error, overlapWarning, onSubmit, onClose,
}: Props) {
  const initial = splitJstDateTime(originalAt)
  const today = todayJstDate()
  const [date, setDate] = useState(initial.date > today ? initial.date : today)
  const [time, setTime] = useState(initial.time)

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', fontSize: '16px', color: PALETTE.text, background: '#fff',
    border: `1px solid ${PALETTE.border}`, borderRadius: '10px', padding: '12px 12px', fontFamily: 'inherit',
  }
  const canSubmit = !!date && !!time && !busy

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="別日に予約"
      data-testid="reschedule-dialog"
      onClick={() => { if (!busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '420px', background: PALETTE.card, borderRadius: '14px',
          padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: PALETTE.text }}>別日に予約</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text }}>{customerName}様</p>
          <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>
            いまの予約: {formatJstMonthDayTime(originalAt)}　{menuName === '未定' ? 'メニュー未定' : menuName}
          </p>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: PALETTE.muted }}>
          日付
          <input
            type="date" data-testid="reschedule-date" value={date} min={today}
            onChange={e => setDate(e.target.value)} disabled={busy} style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: PALETTE.muted }}>
          時間
          <input
            type="time" data-testid="reschedule-time" value={time} step={RESCHEDULE_MINUTE_STEP * 60}
            onChange={e => setTime(e.target.value)} disabled={busy} style={inputStyle}
          />
        </label>

        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
          いまの予約は「変更」に移り、選んだ日時で新しい予約が作られます。サロンボード側には反映されません。
        </p>

        {overlapWarning && (
          <p data-testid="reschedule-overlap" style={{ margin: 0, fontSize: '13px', color: '#B85050', lineHeight: 1.6 }}>
            その時間は、担当スタッフの別の予約と重なっています。
          </p>
        )}
        {error && <p data-testid="reschedule-error" style={{ margin: 0, fontSize: '12px', color: '#B85050' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button" onClick={onClose} disabled={busy}
            style={{
              fontSize: '14px', padding: '10px 18px', borderRadius: '999px',
              border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            戻る
          </button>
          <button
            type="button" data-testid="reschedule-submit" disabled={!canSubmit}
            onClick={() => onSubmit({ date, time, allowOverlap: overlapWarning })}
            style={{
              fontSize: '14px', fontWeight: 700, padding: '10px 18px', borderRadius: '999px', border: 'none',
              background: canSubmit ? PALETTE.gold : PALETTE.border, color: '#fff',
              cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            {busy ? '処理中…' : overlapWarning ? '重なっても予約する' : 'この日時で予約する'}
          </button>
        </div>
      </div>
    </div>
  )
}

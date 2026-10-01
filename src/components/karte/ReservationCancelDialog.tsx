'use client'
/**
 * ReservationCancelDialog.tsx — `/karte`「本日の予約」の当日キャンセル / キャンセル取消の確認モーダル
 * (2026-10-01・当日キャンセル機能)。
 *
 * window.confirmは使わない(iPad Safariでのダイアログ起因のフリーズ回避・見た目統一のため)。
 * 確認後の処理(API呼び出し)は親(KarteEntryScreen)が担い、このコンポーネントは表示と
 * 二重押下防止(busy中は全ボタンdisabled・背景タップでも閉じない)のみを担う。
 */
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'

interface Props {
  title:        string
  /** 本文(1行ずつ表示)。 */
  lines:        string[]
  confirmLabel: string
  busy:         boolean
  error:        string | null
  onConfirm:    () => void
  onClose:      () => void
}

export default function ReservationCancelDialog({ title, lines, confirmLabel, busy, error, onConfirm, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => { if (!busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '400px', background: PALETTE.card, borderRadius: '14px',
          padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: PALETTE.text }}>{title}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {lines.map((line, i) => (
            <p key={i} style={{ margin: 0, fontSize: '14px', color: PALETTE.text, lineHeight: 1.6 }}>{line}</p>
          ))}
        </div>
        {error && <p style={{ margin: 0, fontSize: '12px', color: '#B85050' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              fontSize: '14px', padding: '10px 18px', borderRadius: '999px',
              border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            戻る
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              fontSize: '14px', fontWeight: 700, padding: '10px 18px', borderRadius: '999px',
              border: 'none', background: busy ? PALETTE.border : '#B85050', color: '#fff',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? '処理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

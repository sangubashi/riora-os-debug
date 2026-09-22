'use client'
/**
 * StaffPinModal.tsx — お客様モード→スタッフ用カルテ切替のPIN入力(2026-09-22ユーザー承認)。
 *
 * 従来のロゴ1000ms長押し(PHASE IPAD-KARTE-ENTRY-1)に代えて採用。お客様が偶然/興味本位で
 * スタッフ画面へ迷い込むのを防ぐための誤操作防止ゲートであり、本格的な認証機構ではない
 * (STAFF_MODE_SWITCH_PIN、src/lib/constants.ts参照)。4桁揃った時点で自動判定し、
 * 正しければonSuccess、誤りなら入力をクリアしてエラー表示する。
 */
import { useState } from 'react'
import { Delete } from 'lucide-react'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { STAFF_MODE_SWITCH_PIN } from '@/lib/constants'

const PIN_LENGTH = 4
const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

interface Props {
  onSuccess: () => void
  onClose: () => void
}

export default function StaffPinModal({ onSuccess, onClose }: Props) {
  const [digits, setDigits] = useState('')
  const [error, setError] = useState(false)

  const pressDigit = (d: string) => {
    if (digits.length >= PIN_LENGTH) return
    const next = digits + d
    setError(false)
    if (next.length < PIN_LENGTH) {
      setDigits(next)
      return
    }
    if (next === STAFF_MODE_SWITCH_PIN) {
      onSuccess()
      return
    }
    setDigits(next)
    setError(true)
    setTimeout(() => setDigits(''), 350)
  }

  const backspace = () => setDigits(d => d.slice(0, -1))

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(30,24,16,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: PALETTE.bg, borderRadius: '20px', width: '100%', maxWidth: '300px',
          padding: '28px 22px', border: `1px solid ${PALETTE.border}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
        }}
      >
        <p
          style={{
            margin: 0, fontSize: '16px', color: PALETTE.gold, textAlign: 'center',
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          スタッフ用カルテへ切替
        </p>
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, textAlign: 'center' }}>
          4桁の暗証番号を入力してください
        </p>

        <div style={{ display: 'flex', gap: '10px' }}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              style={{
                width: '38px', height: '46px', borderRadius: '10px',
                border: `1.5px solid ${error ? '#C0392B' : PALETTE.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', color: PALETTE.text,
              }}
            >
              {digits[i] ? '●' : ''}
            </div>
          ))}
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: '11px', color: '#C0392B' }}>暗証番号が違います</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {KEYPAD_DIGITS.map(d => (
            <button key={d} type="button" onClick={() => pressDigit(d)} style={keypadButtonStyle}>
              {d}
            </button>
          ))}
          <div />
          <button type="button" onClick={() => pressDigit('0')} style={keypadButtonStyle}>
            0
          </button>
          <button type="button" onClick={backspace} aria-label="1文字削除" style={keypadButtonStyle}>
            <Delete size={18} strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: PALETTE.muted, fontSize: '12px', cursor: 'pointer' }}
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}

const keypadButtonStyle: React.CSSProperties = {
  width: '56px', height: '56px', borderRadius: '50%', cursor: 'pointer',
  border: `1px solid ${PALETTE.border}`, background: 'transparent', color: PALETTE.text,
  fontSize: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
}

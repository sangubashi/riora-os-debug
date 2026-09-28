'use client'
/**
 * TreatmentCourseEditModal.tsx — 「💆 今回の施術コース」選択モーダル(2026-09-28ユーザー承認)。
 *
 * `/karte`のPIN保護スタッフモード(IpadStaffKarteView.tsx)専用。固定14項目からの
 * 複数選択(ON/OFFトグル)を、当日visitのbrain_visits.course_options(新規列)へ
 * 直接保存する。保存先API(PATCH /api/customers/[id]/visits/[visitId]/treatment)は
 * 既存の「今日の施術記録」用エンドポイントを拡張したもので、courseOptionsフィールドの
 * みを送信する(options/productsUsed/treatmentMemo等の既存フィールドには一切触れない)。
 */
import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

/**
 * コース選択肢の固定14項目(2026-09-28ユーザー承認、依頼どおりの文言・順序)。
 * 「(内容カルテ記入)」付きの項目は、コース内容が都度変わるためカルテメモへの
 * 別途記入を前提とする(この選択自体は「どのコースを実施したか」のフラグのみ)。
 */
export const TREATMENT_COURSE_OPTIONS = [
  'サブスク消化(内容カルテ記入)',
  '回数券消化(内容カルテ記入)',
  'スク→ポレ→マイカレ→乳歯パック',
  'ハイドラ→ポレ→マイカレ→乳歯パック',
  'スク→ポレ→マイカレ→→水素→乳歯パック',
  'スク→ハーブ3→4→ポレ→5→肌別パック',
  'スク→ハーブ345→肌別パック(ツルピカ)',
  'スク→ポレ→EMS→FM→乳歯パック',
  'スク→ハイフ→ポレ→乳歯パック',
  '造顔→ハイフ→ポレ→乳歯パック',
  'スク→ポレ→炭酸',
  'ハーブ345→導入パック→乳歯パック',
  'メンズハイドラ(内容カルテ記入)',
  '背中ケア(内容カルテ記入)',
] as const

interface Props {
  customerId: string
  visitId:    string
  existing:   string[]
  onClose:    () => void
  /** 保存成功時に呼ばれる(親側で今回の施術コース表示を再取得させる想定)。 */
  onSaved:    () => void
}

interface PatchResponse {
  success: boolean
  error?:  string
}

export default function TreatmentCourseEditModal({ customerId, visitId, existing, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(existing))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(label: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/visits/${visitId}/treatment`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ courseOptions: Array.from(selected) }),
      })
      const json = await res.json() as PatchResponse
      if (!res.ok || !json.success) {
        setError('保存に失敗しました')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{
        background: PALETTE.bg, borderRadius: '16px', maxWidth: '520px', width: '100%',
        maxHeight: '85vh', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            今回の施術コースを選択
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
          該当する項目をタップしてON/OFFしてください。ONにした項目は画面に即座に反映されます。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {TREATMENT_COURSE_OPTIONS.map(label => {
            const isOn = selected.has(label)
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggle(label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
                  padding: '10px 12px', borderRadius: '12px', cursor: 'pointer',
                  border: `1.5px solid ${isOn ? PALETTE.gold : PALETTE.border}`,
                  background: isOn ? 'rgba(173,138,84,0.10)' : 'none',
                }}
              >
                <span style={{
                  flexShrink: 0, width: '20px', height: '20px', borderRadius: '6px',
                  border: `1.5px solid ${isOn ? PALETTE.gold : PALETTE.muted}`,
                  background: isOn ? PALETTE.gold : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isOn && <Check size={13} color="#fff" strokeWidth={3} />}
                </span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: isOn ? PALETTE.gold : PALETTE.text }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {error && <p style={{ margin: 0, fontSize: '12px', color: '#B85050' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: '13px', padding: '8px 16px', borderRadius: '999px', border: `1px solid ${PALETTE.border}`, background: 'none', color: PALETTE.muted, cursor: 'pointer' }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '13px', fontWeight: 700, padding: '8px 18px', borderRadius: '999px',
              border: 'none', background: saving ? PALETTE.border : PALETTE.gold, color: '#fff',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            <Check size={14} />{saving ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}

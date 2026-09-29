'use client'
/**
 * PastVisitMemoEditModal.tsx — 「✏️ 自由記述」過去来店メモ編集モーダル(2026-09-29ユーザー承認)。
 *
 * `/karte`のPIN保護スタッフモード(IpadStaffKarteView.tsx→VisitHistorySection.tsx)専用。
 * brain_visits.treatment_memo(TreatmentRecordSection.tsx が本日分の記録に使うのと同じ列)を、
 * 任意の過去visitIdに対して直接編集・保存する。TreatmentCourseEditModal.tsx/
 * TreatmentOptionEditModal.tsxの過去来店編集(2026-09-28ユーザー承認)と同じくPATCH
 * /api/customers/[id]/visits/[visitId]/treatmentを使う(courseOptions/optionItemsとは
 * 独立したtreatmentMemoフィールドのみを送信、他フィールドは未指定のまま=更新しない)。
 *
 * source列は変更しない: このAPIはtreatment_memo更新時にbrain_visits.source列に一切
 * 触れないため(csvImportPipeline.tsのreconcile()が更新するのはstaffId/menuId/
 * isNomination/treatmentAmount/retailAmount/checkoutId/source自体のみで、
 * treatment_memoはreconcile対象外)、過去来店(SalonBoard CSV取込由来を含む)を編集しても
 * 翌日以降のCSV再取込で上書きされることはない。
 */
import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

interface Props {
  customerId:  string
  visitId:     string
  existing:    string | null
  dateLabel:   string
  onClose:     () => void
  /** 保存成功時に呼ばれる(親側で表示中のtreatmentMemoを更新する想定)。 */
  onSaved:     (visitId: string, treatmentMemo: string | null) => void
}

interface PatchResponse {
  success:    boolean
  treatment?: { visitId: string; treatmentMemo?: string | null }
  error?:     string
}

export default function PastVisitMemoEditModal({ customerId, visitId, existing, dateLabel, onClose, onSaved }: Props) {
  const [content, setContent] = useState(existing ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const trimmed = content.trim()
      const res = await authedFetch(`/api/customers/${customerId}/visits/${visitId}/treatment`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ treatmentMemo: trimmed.length > 0 ? trimmed : null }),
      })
      const json = await res.json() as PatchResponse
      if (!res.ok || !json.success || !json.treatment) {
        setError('保存に失敗しました')
        return
      }
      onSaved(json.treatment.visitId, json.treatment.treatmentMemo ?? null)
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
        background: PALETTE.bg, borderRadius: '16px', maxWidth: '560px', width: '100%',
        maxHeight: '85vh', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            {dateLabel}の自由記述メモを編集
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <textarea
          value={content}
          onChange={e => setContent(e.target.value.slice(0, 1000))}
          rows={10}
          autoFocus
          placeholder="この来店日の施術内容・気づきを自由に記入してください"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '200px',
            fontSize: '14px', color: PALETTE.text, lineHeight: 1.7,
            border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px',
            outline: 'none', fontFamily: 'inherit',
          }}
        />

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

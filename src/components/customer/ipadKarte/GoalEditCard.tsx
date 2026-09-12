'use client'
/**
 * GoalEditCard.tsx — iPadスタッフカルテ用「🎯 目標」編集カード(PHASE IPAD-6・2026-09-12)。
 *
 * 背景: goal_noteの編集UI(GoalSection.tsx)はCustomerBottomSheet.tsxにのみ存在し、
 * 196人中0人という実データから定着していないことが判明したため、iPadスタッフカルテ側にも
 * 編集導線を追加する(READ ONLY調査に基づく)。
 *
 * GoalSection.tsxのロジック(編集/保存/キャンセル・PATCH /api/customers/[id]/goal)を
 * そのまま踏襲しつつ、見た目はKarteMemoSection.tsxと同じくPhotoCompareKit.tsxのPALETTE
 * (アイボリー×ゴールド)に合わせて新規に書き起こしている(GoalSection.tsx自体は無変更・
 * CustomerBottomSheet.tsxは一切触れない)。
 *
 * goalNoteはIpadStaffKarteView側で既にuseIpadKarteDataが取得済みのため、このコンポーネント
 * 自身はfetchを行わない(props経由で受け取るだけ)。保存成功時はonSavedを呼び、
 * 呼び出し元がdata.refetchGoalAndContraindications()等で画面を更新する想定。
 */
import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'

/** サーバー側(zod .max(1000))と揃える。無駄な400往復を避けるためクライアント側でも先に切り詰める。 */
const MAX_GOAL_NOTE_LENGTH = 1000

interface Props {
  customerId: string
  goalNote: string | null
  onSaved: () => void
}

export default function GoalEditCard({ customerId, goalNote, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft(goalNote ?? '')
    setEditing(true)
  }

  function cancelEdit() {
    if (saving) return
    setEditing(false)
    setDraft('')
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/goal`, {
        method: 'PATCH',
        body: JSON.stringify({ goalNote: draft.trim() }),
      })
      if (!res.ok) throw new Error('save failed')
      setEditing(false)
      onSaved()
      toast.success('顧客目標を保存しました', { duration: 1500 })
    } catch {
      toast.error('顧客目標の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="🎯 目標">
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, MAX_GOAL_NOTE_LENGTH))}
            rows={3}
            autoFocus
            disabled={saving}
            placeholder="例: 結婚式までに毛穴・たるみを改善したい"
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              fontSize: '13px', color: PALETTE.text, lineHeight: 1.7,
              border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '8px',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
                cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              <X size={11} />キャンセル
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
                border: 'none', background: saving ? PALETTE.border : PALETTE.gold, color: '#fff',
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              <Check size={11} />{saving ? '保存中…' : '保存する'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
          <p
            style={{
              margin: 0, fontSize: '14px', lineHeight: 1.8, whiteSpace: 'pre-wrap', flex: 1,
              color: goalNote?.trim() ? PALETTE.text : PALETTE.muted,
            }}
          >
            {goalNote?.trim() ? goalNote : 'まだ登録されていません'}
          </p>
          <button
            type="button"
            onClick={startEdit}
            aria-label="目標を編集"
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '11px', fontWeight: 600, color: PALETTE.gold,
              background: PALETTE.bg, border: `1px solid ${PALETTE.border}`,
              borderRadius: '999px', padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <Pencil size={11} />編集
          </button>
        </div>
      )}
    </Card>
  )
}

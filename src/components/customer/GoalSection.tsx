'use client'
/**
 * GoalSection.tsx
 * デジタル顧客カルテ Phase1-B①: 🎯顧客目標カード。
 *
 * brain_customers.goal_note の表示・編集のみを扱う自己完結コンポーネント
 * (CustomerNotesSection/CustomerMemorySection と同じ「customerIdを受け取り
 * 自前でfetchする」パターンを踏襲。CustomerBottomSheet本体の巨大なstate/
 * useEffectには一切触れない)。
 *
 * 使用API: GET/PATCH /api/customers/[id]/goal（Phase1-A実装済み）。
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'

interface GoalSectionProps {
  customerId: string
}

/** サーバー側(zod .max(1000))と揃える。無駄な400往復を避けるためクライアント側でも先に切り詰める。 */
const MAX_GOAL_NOTE_LENGTH = 1000

const GoalSectionInner = memo(function GoalSection({ customerId }: GoalSectionProps) {
  const [goalNote, setGoalNote] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState('')
  const [saving,   setSaving]   = useState(false)

  // 顧客切替時に再取得。編集中の状態も必ずリセットする(別顧客の下書きが残らないように)。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEditing(false)
    setDraft('')
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}/goal`)
        if (res.ok) {
          const json = await res.json() as { success: boolean; goalNote?: string | null }
          if (!cancelled && json.success) setGoalNote(json.goalNote ?? null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  const startEdit = useCallback(() => {
    setDraft(goalNote ?? '')
    setEditing(true)
  }, [goalNote])

  const cancelEdit = useCallback(() => {
    if (saving) return
    setEditing(false)
    setDraft('')
  }, [saving])

  const handleSave = useCallback(async () => {
    if (saving) return // 二重送信防止
    setSaving(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/goal`, {
        method: 'PATCH',
        body:   JSON.stringify({ goalNote: draft.trim() }),
      })
      if (!res.ok) throw new Error('save failed')
      const json = await res.json() as { success: boolean; goalNote?: string | null }
      if (!json.success) throw new Error('save failed')
      setGoalNote(json.goalNote ?? null)
      setEditing(false)
      toast.success('顧客目標を保存しました', { duration: 1500 })
    } catch {
      toast.error('顧客目標の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [customerId, draft, saving])

  return (
    <div className="bg-[#F8F1F3] rounded-[22px] p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold">🎯 顧客目標</p>
        {!editing && !loading && (
          <button
            onClick={startEdit}
            className="text-[11px] text-[#C8A58C] bg-white border border-[#F5E6E8] rounded-full px-3 py-0.5 cursor-pointer"
          >
            編集
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : editing ? (
        <div className="flex flex-col gap-2.5">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, MAX_GOAL_NOTE_LENGTH))}
            placeholder="例: 結婚式までに毛穴・たるみを改善したい"
            rows={2}
            autoFocus
            disabled={saving}
            className="w-full resize-none text-sm text-[#5C4033] bg-white rounded-2xl p-3 border border-[#F5E6E8] outline-none leading-relaxed font-['Noto_Sans_JP'] box-border disabled:opacity-60"
          />
          <div className="flex gap-2">
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="flex-1 py-2.5 rounded-full text-sm font-bold bg-white border border-[#F5E6E8] text-[#9F7E6C] cursor-pointer disabled:opacity-60"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
                saving ? 'bg-[#F5D6DB] cursor-default' : 'bg-[#F56E8B] cursor-pointer'
              }`}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#5C4033] leading-relaxed whitespace-pre-wrap">
          {goalNote?.trim() ? `「${goalNote}」` : 'まだ顧客目標が登録されていません'}
        </p>
      )}
    </div>
  )
})

GoalSectionInner.displayName = 'GoalSection'
export default GoalSectionInner

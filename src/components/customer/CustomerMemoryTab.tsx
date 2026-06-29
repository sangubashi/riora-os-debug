'use client'

/**
 * CustomerMemoryTab — Customer Memory 管理ページ（Phase 3）
 *
 * 用途: 編集 / 削除（追加は CustomerMemorySection のインラインフォームを使用）
 * デザイン: 既存 CustomerBottomSheet カードスタイルに統一
 *
 * 絶対ルール: ProposalOrchestrator / FireScore / PatternEngine / LINE提案 へ
 * import しないこと。content 参照禁止。
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Trash2, Edit2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import type { CustomerMemory, MemoryType, MemoryImportance } from '@/types/customerMemory'
import {
  MEMORY_TYPE_EMOJI,
  MEMORY_TYPE_LABELS,
  IMPORTANCE_LABELS,
} from '@/types/customerMemory'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  customerId: string
  staffId:    string | null
  onBack:     () => void
}

// ── Form ─────────────────────────────────────────────────────────────────────

interface EditForm {
  content:      string
  memory_type:  MemoryType
  trigger_date: string
  importance:   MemoryImportance
  is_sensitive: boolean
}

const MEMORY_TYPES: MemoryType[] = [
  'family', 'anniversary', 'hobby', 'occupation',
  'life_event', 'travel', 'pet', 'other',
]
const IMPORTANCES: MemoryImportance[] = ['low', 'medium', 'high']

const IMP_STYLE: Record<MemoryImportance, { bg: string; color: string }> = {
  low:    { bg: 'rgba(159,126,108,0.12)', color: '#9F7E6C' },
  medium: { bg: 'rgba(245,110,139,0.10)', color: '#F56E8B' },
  high:   { bg: 'rgba(245,110,139,0.18)', color: '#C84060' },
}

const IMP_DOT: Record<MemoryImportance, string> = {
  low: '#C8A8B0', medium: '#F5A0B8', high: '#E03060',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerMemoryTab({ customerId, onBack }: Props) {
  const [memories,  setMemories]  = useState<CustomerMemory[]>([])
  const [loading,   setLoading]   = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form,      setForm]      = useState<EditForm | null>(null)
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/customer-memories?customer_id=${encodeURIComponent(customerId)}`
      )
      if (!res.ok) return
      const { memories: data } = await res.json() as { memories: CustomerMemory[] }
      setMemories(data)
    } catch { toast.error('読み込みに失敗しました') }
    finally { setLoading(false) }
  }, [customerId])

  useEffect(() => { load() }, [load])

  function startEdit(m: CustomerMemory) {
    setEditingId(m.id)
    setForm({
      content:      m.content,
      memory_type:  m.memory_type,
      trigger_date: m.trigger_date ?? '',
      importance:   m.importance,
      is_sensitive: m.is_sensitive,
    })
  }

  function cancelEdit() { setEditingId(null); setForm(null) }

  async function handleUpdate() {
    if (!editingId || !form) return
    if (!form.content.trim()) { toast.error('内容を入力してください'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/customer-memories/${editingId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content:      form.content.trim(),
          memory_type:  form.memory_type,
          trigger_date: form.trigger_date || null,
          importance:   form.importance,
          is_sensitive: form.is_sensitive,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('更新しました')
      cancelEdit()
      await load()
    } catch { toast.error('更新に失敗しました') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/customer-memories/${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('削除に失敗しました'); return }
    toast.success('削除しました')
    setMemories(prev => prev.filter(m => m.id !== id))
    if (editingId === id) cancelEdit()
  }

  const normal    = memories.filter(m => !m.is_sensitive)
  const sensitive = memories.filter(m => m.is_sensitive)

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* ヘッダー */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-1 pb-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 bg-transparent border-none cursor-pointer text-[#C8A58C] text-sm"
        >
          <ChevronLeft size={16} strokeWidth={2} />戻る
        </button>
        <div className="text-center">
          <p className="text-[11px] text-[#F56E8B] font-medium tracking-[0.12em] mb-0.5">
            覚えておくこと
          </p>
          <p className="text-lg font-bold text-[#3d2218]">Memory 管理</p>
        </div>
        <div className="w-14" />
      </div>

      {/* スクロール領域 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={{
          padding: '4px 20px 24px',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {loading ? (
          <p className="text-[12px] text-[#C8A8B0] text-center py-8">読み込み中…</p>
        ) : memories.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[12px] text-[#C8A8B0]">まだ登録されていません</p>
            <p className="text-[11px] text-[#D4C0C4] mt-1">
              概要画面の「＋ Memory」から追加できます
            </p>
          </div>
        ) : (
          <>
            {/* 通常メモリー */}
            {normal.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-medium text-[#C8A8B0] tracking-widest px-1">
                  メモリー
                </p>
                {normal.map(m => (
                  <MemoryCard
                    key={m.id}
                    memory={m}
                    isEditing={editingId === m.id}
                    form={editingId === m.id ? form : null}
                    saving={saving}
                    onEdit={() => startEdit(m)}
                    onCancel={cancelEdit}
                    onUpdate={handleUpdate}
                    onDelete={() => handleDelete(m.id)}
                    onFormChange={setForm}
                  />
                ))}
              </div>
            )}

            {/* 触れない話題 */}
            {sensitive.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-medium text-[#B84050] tracking-widest px-1">
                  ⚠ 触れない話題
                </p>
                {sensitive.map(m => (
                  <MemoryCard
                    key={m.id}
                    memory={m}
                    isEditing={editingId === m.id}
                    form={editingId === m.id ? form : null}
                    saving={saving}
                    onEdit={() => startEdit(m)}
                    onCancel={cancelEdit}
                    onUpdate={handleUpdate}
                    onDelete={() => handleDelete(m.id)}
                    onFormChange={setForm}
                    isSensitiveSection
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── MemoryCard サブコンポーネント ─────────────────────────────────────────────

interface CardProps {
  memory:          CustomerMemory
  isEditing:       boolean
  form:            EditForm | null
  saving:          boolean
  isSensitiveSection?: boolean
  onEdit:          () => void
  onCancel:        () => void
  onUpdate:        () => void
  onDelete:        () => void
  onFormChange:    (f: EditForm | null) => void
}

function MemoryCard({
  memory: m, isEditing, form, saving,
  isSensitiveSection,
  onEdit, onCancel, onUpdate, onDelete, onFormChange,
}: CardProps) {
  const emoji = MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝'

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!isEditing ? (
        <motion.div
          key="view"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="rounded-[14px] px-4 py-3 flex items-start gap-3"
          style={{
            border:     isSensitiveSection ? '1px solid rgba(210,50,50,0.14)' : '1px solid #F0E8E8',
            background: isSensitiveSection ? 'rgba(210,50,50,0.04)' : '#FEFCFD',
          }}
        >
          <span className="text-base flex-shrink-0 mt-0.5">{emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] text-[#5C4033] break-words leading-snug">
              {m.content}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                className="text-[9px] w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: IMP_DOT[m.importance], marginRight: '-4px' }}
              />
              <span className="text-[9px] text-[#C8A8B0]">
                {IMPORTANCE_LABELS[m.importance]}
              </span>
              <span className="text-[9px] text-[#C8A8B0]">
                {MEMORY_TYPE_LABELS[m.memory_type as MemoryType]}
              </span>
              {m.trigger_date && (
                <span className="text-[9px] text-[#C8A8B0]">📅 {m.trigger_date}</span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={onEdit}
              className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
              style={{ background: '#F5EEF0' }}
            >
              <Edit2 size={11} color="#9F7E6C" />
            </button>
            <button
              onClick={onDelete}
              className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
              style={{ background: '#FFF0F2' }}
            >
              <Trash2 size={11} color="#E08090" />
            </button>
          </div>
        </motion.div>

      ) : (
        <motion.div
          key="edit"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="rounded-[14px] px-4 py-3 flex flex-col gap-3"
          style={{ border: '1.5px solid rgba(245,110,139,0.35)', background: '#FFFBFC' }}
        >
          {/* 内容 */}
          <textarea
            value={form?.content ?? ''}
            onChange={e => form && onFormChange({ ...form, content: e.target.value })}
            rows={2}
            autoFocus
            className="w-full text-sm text-[#5C4033] bg-transparent border-none outline-none resize-none leading-relaxed"
            style={{ borderBottom: '1px solid #F0E8E8', paddingBottom: '6px' }}
          />

          {/* カテゴリ */}
          <div className="flex flex-wrap gap-1.5">
            {MEMORY_TYPES.map(t => (
              <button
                key={t}
                onClick={() => form && onFormChange({ ...form, memory_type: t })}
                className="text-[10px] px-2 py-0.5 rounded-full border-none cursor-pointer"
                style={{
                  background: form?.memory_type === t ? 'rgba(245,110,139,0.12)' : '#F5EEF0',
                  color:      form?.memory_type === t ? '#F56E8B' : '#9F7E6C',
                  fontWeight: form?.memory_type === t ? 600 : 400,
                }}
              >
                {MEMORY_TYPE_EMOJI[t]}{MEMORY_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* 重要度 + 日付 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="flex gap-1.5">
                {IMPORTANCES.map(imp => (
                  <button
                    key={imp}
                    onClick={() => form && onFormChange({ ...form, importance: imp })}
                    className="flex-1 text-[10px] py-1 rounded-full border-none cursor-pointer"
                    style={{
                      background: form?.importance === imp ? IMP_STYLE[imp].bg    : '#F5EEF0',
                      color:      form?.importance === imp ? IMP_STYLE[imp].color : '#C8A8B0',
                      fontWeight: form?.importance === imp ? 700 : 400,
                    }}
                  >
                    {IMPORTANCE_LABELS[imp]}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="date"
              value={form?.trigger_date ?? ''}
              onChange={e => form && onFormChange({ ...form, trigger_date: e.target.value })}
              className="flex-1 text-[11px] text-[#5C4033] bg-transparent border-none outline-none"
              style={{ borderBottom: '1px solid #F0E8E8' }}
            />
          </div>

          {/* Sensitive */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form?.is_sensitive ?? false}
              onChange={e => form && onFormChange({ ...form, is_sensitive: e.target.checked })}
              className="w-3.5 h-3.5 accent-[#F56E8B]"
            />
            <span className="text-[11px] text-[#9F7E6C]">⚠ センシティブ</span>
          </label>

          {/* ボタン行 */}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex items-center gap-1 text-[11px] px-3 py-2 rounded-full border-none cursor-pointer"
              style={{ background: '#F5EEF0', color: '#9F7E6C' }}
            >
              <X size={11} />キャンセル
            </button>
            <button
              onClick={onUpdate}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1 text-[12px] font-bold py-2 rounded-full border-none"
              style={{
                background: saving ? '#E8D5D8' : '#F56E8B',
                color:      'white',
                cursor:     saving ? 'not-allowed' : 'pointer',
                boxShadow:  saving ? 'none' : '0 4px 12px rgba(245,110,139,0.3)',
              }}
            >
              <Check size={13} />
              {saving ? '更新中…' : '更新する'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

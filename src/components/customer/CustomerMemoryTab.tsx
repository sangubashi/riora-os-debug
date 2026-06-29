'use client'

/**
 * CustomerMemoryTab — 「Customer Memory」管理タブ
 *
 * 機能: 一覧表示 / 新規追加 / 編集 / 削除
 *
 * 絶対ルール: このコンポーネントのデータを ProposalOrchestrator /
 * FireScore / AI提案 / LINE提案 へ渡さないこと。
 */

import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, Trash2, Edit2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import type { CustomerMemory, MemoryType, MemoryImportance } from '@/types/customerMemory'
import {
  MEMORY_TYPE_LABELS,
  MEMORY_TYPE_EMOJI,
  IMPORTANCE_LABELS,
} from '@/types/customerMemory'

interface Props {
  customerId: string
  staffId:    string | null
  onBack:     () => void
}

const MEMORY_TYPES: MemoryType[] = [
  'family', 'anniversary', 'hobby', 'occupation',
  'life_event', 'travel', 'pet', 'other',
]
const IMPORTANCES: MemoryImportance[] = ['low', 'medium', 'high']

const IMPORTANCE_COLOR: Record<MemoryImportance, string> = {
  low:    '#C8A8B0',
  medium: '#9F7E6C',
  high:   '#F56E8B',
}

interface FormState {
  content:      string
  memory_type:  MemoryType
  trigger_date: string
  importance:   MemoryImportance
  is_sensitive: boolean
}

const EMPTY_FORM: FormState = {
  content:      '',
  memory_type:  'other',
  trigger_date: '',
  importance:   'medium',
  is_sensitive: false,
}

export default function CustomerMemoryTab({ customerId, staffId, onBack }: Props) {
  const [memories,  setMemories]  = useState<CustomerMemory[]>([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form,      setForm]      = useState<FormState>({ ...EMPTY_FORM })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/customer-memories?customer_id=${encodeURIComponent(customerId)}`)
      if (!res.ok) return
      const { memories: data } = await res.json() as { memories: CustomerMemory[] }
      setMemories(data)
    } catch {
      toast.error('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
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

  function cancelEdit() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
  }

  async function handleSave() {
    if (!form.content.trim()) {
      toast.error('内容を入力してください')
      return
    }
    setSaving(true)
    try {
      const payload = {
        content:      form.content.trim(),
        memory_type:  form.memory_type,
        trigger_date: form.trigger_date || null,
        importance:   form.importance,
        is_sensitive: form.is_sensitive,
      }

      if (editingId) {
        const res = await fetch(`/api/customer-memories/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('update failed')
        toast.success('更新しました')
      } else {
        const res = await fetch('/api/customer-memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: customerId,
            created_by:  staffId,
            ...payload,
          }),
        })
        if (!res.ok) throw new Error('create failed')
        toast.success('保存しました')
      }

      setEditingId(null)
      setForm({ ...EMPTY_FORM })
      await load()
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/customer-memories/${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('削除に失敗しました'); return }
    toast.success('削除しました')
    setMemories(prev => prev.filter(m => m.id !== id))
    if (editingId === id) cancelEdit()
  }

  const isEditing = editingId !== null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ヘッダー */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-1 pb-3">
        <button onClick={onBack}
          className="flex items-center gap-1 bg-transparent border-none cursor-pointer text-[#C8A58C] text-sm">
          <ChevronLeft size={16} strokeWidth={2} />戻る
        </button>
        <div className="text-center">
          <p className="text-[11px] text-[#F56E8B] font-medium tracking-[0.12em] mb-0.5">
            覚えておくこと
          </p>
          <p className="text-lg font-bold text-[#3d2218]">Customer Memory</p>
        </div>
        <div className="w-12" />
      </div>

      {/* スクロール領域 */}
      <div className="flex-1 min-h-0 overflow-y-auto"
        style={{
          padding: '0 20px 24px',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>

        {/* 入力フォーム */}
        <div className="rounded-[18px] p-4"
          style={{ border: '1px solid #F5EEF0', background: '#FFFBFC' }}>
          <p className="text-[11px] font-bold text-[#9F7E6C] mb-3 tracking-wide">
            {isEditing ? '✏️ 編集' : '＋ 新規追加'}
          </p>

          {/* 内容 */}
          <textarea
            value={form.content}
            onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
            placeholder="例：娘さんが受験中、ゴルフが趣味"
            rows={2}
            className="w-full text-sm text-[#5C4033] bg-transparent border-none outline-none resize-none placeholder-[#D4B8BC] mb-3"
            style={{ borderBottom: '1px solid #F0E8E8', paddingBottom: '8px' }}
          />

          {/* カテゴリ */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {MEMORY_TYPES.map(t => (
              <button key={t}
                onClick={() => setForm(p => ({ ...p, memory_type: t }))}
                className="text-[10px] px-2.5 py-1 rounded-full border-none cursor-pointer transition-all"
                style={{
                  background: form.memory_type === t ? 'rgba(245,110,139,0.12)' : '#F5EEF0',
                  color:      form.memory_type === t ? '#F56E8B' : '#9F7E6C',
                  fontWeight: form.memory_type === t ? 600 : 400,
                }}>
                {MEMORY_TYPE_EMOJI[t]} {MEMORY_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* 重要度 + 日付 */}
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <p className="text-[10px] text-[#C8A8B0] mb-1">重要度</p>
              <div className="flex gap-1.5">
                {IMPORTANCES.map(imp => (
                  <button key={imp}
                    onClick={() => setForm(p => ({ ...p, importance: imp }))}
                    className="flex-1 text-[10px] py-1 rounded-full border-none cursor-pointer"
                    style={{
                      background: form.importance === imp
                        ? `rgba(245,110,139,${imp === 'high' ? '0.15' : imp === 'medium' ? '0.08' : '0.04'})`
                        : '#F5EEF0',
                      color:     form.importance === imp ? IMPORTANCE_COLOR[imp] : '#C8A8B0',
                      fontWeight: form.importance === imp ? 700 : 400,
                    }}>
                    {IMPORTANCE_LABELS[imp]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-[#C8A8B0] mb-1">日付（任意）</p>
              <input
                type="date"
                value={form.trigger_date}
                onChange={e => setForm(p => ({ ...p, trigger_date: e.target.value }))}
                className="w-full text-[11px] text-[#5C4033] bg-transparent border-none outline-none"
                style={{ borderBottom: '1px solid #F0E8E8', paddingBottom: '4px' }}
              />
            </div>
          </div>

          {/* センシティブ */}
          <label className="flex items-center gap-2 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={form.is_sensitive}
              onChange={e => setForm(p => ({ ...p, is_sensitive: e.target.checked }))}
              className="w-3.5 h-3.5 accent-[#F56E8B]"
            />
            <span className="text-[11px] text-[#9F7E6C]">⚠ センシティブ（要配慮情報）</span>
          </label>

          {/* ボタン */}
          <div className="flex gap-2">
            {isEditing && (
              <button onClick={cancelEdit}
                className="flex-shrink-0 flex items-center gap-1 text-[12px] px-3 py-2 rounded-full border-none cursor-pointer"
                style={{ background: '#F5EEF0', color: '#9F7E6C' }}>
                <X size={12} />キャンセル
              </button>
            )}
            <button onClick={handleSave} disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-bold py-2.5 rounded-full border-none cursor-pointer"
              style={{
                background: saving ? '#E8D5D8' : '#F56E8B',
                color: 'white',
                boxShadow: saving ? 'none' : '0 4px 12px rgba(245,110,139,0.35)',
              }}>
              <Check size={14} />
              {saving ? '保存中…' : isEditing ? '更新する' : '保存する'}
            </button>
          </div>
        </div>

        {/* 一覧 */}
        {loading ? (
          <p className="text-[12px] text-[#C8A8B0] text-center py-4">読み込み中…</p>
        ) : memories.length === 0 ? (
          <p className="text-[12px] text-[#C8A8B0] text-center py-4">まだ登録されていません</p>
        ) : (
          <div className="flex flex-col gap-2">
            {memories.map(m => (
              <div key={m.id}
                className="rounded-[14px] px-4 py-3 flex items-start gap-3"
                style={{
                  border: `1px solid ${editingId === m.id ? '#F56E8B' : '#F0E8E8'}`,
                  background: m.is_sensitive ? '#FFF8F8' : '#FEFCFD',
                  opacity: editingId !== null && editingId !== m.id ? 0.5 : 1,
                }}>
                <span className="text-base flex-shrink-0 mt-0.5">
                  {MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[#5C4033] break-words leading-snug">
                    {m.content}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{
                        background: `rgba(245,110,139,${m.importance === 'high' ? '0.12' : '0.06'})`,
                        color: IMPORTANCE_COLOR[m.importance],
                      }}>
                      {IMPORTANCE_LABELS[m.importance]}
                    </span>
                    <span className="text-[9px] text-[#C8A8B0]">
                      {MEMORY_TYPE_LABELS[m.memory_type as MemoryType]}
                    </span>
                    {m.trigger_date && (
                      <span className="text-[9px] text-[#C8A8B0]">📅 {m.trigger_date}</span>
                    )}
                    {m.is_sensitive && (
                      <span className="text-[9px] text-[#D06070]">⚠ センシティブ</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button onClick={() => startEdit(m)}
                    className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                    style={{ background: '#F5EEF0' }}>
                    <Edit2 size={11} color="#9F7E6C" />
                  </button>
                  <button onClick={() => handleDelete(m.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                    style={{ background: '#FFF0F2' }}>
                    <Trash2 size={11} color="#E08090" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

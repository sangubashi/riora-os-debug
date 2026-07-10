'use client'

/**
 * CustomerMemorySection — 覚えておくこと（Phase 3）
 *
 * - ブリーフィング: 顧客ヘッダー直下・AI提案より上
 * - インライン追加: "+ Memory" → add form view（AnimatePresence）
 * - Sensitive 別カード: ⚠ 触れない話題
 * - 編集/削除: onManage() → CustomerMemoryTab
 *
 * 絶対ルール: このファイルを ProposalOrchestrator / FireScore /
 * PatternEngine / LINE提案 へ import しないこと。content 参照禁止。
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, ChevronLeft, Mic } from 'lucide-react'
import { toast } from 'sonner'
import type { CustomerMemory, MemoryType, MemoryImportance } from '@/types/customerMemory'
import { authedFetch } from '@/lib/api/authedFetch'
import {
  MEMORY_TYPE_EMOJI,
  MEMORY_TYPE_LABELS,
  IMPORTANCE_LABELS,
} from '@/types/customerMemory'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  customerId:  string
  onManage:    () => void
  refreshKey?: number
}

// ── Form ─────────────────────────────────────────────────────────────────────

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

// ── Sort ─────────────────────────────────────────────────────────────────────

const IMP_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tgt   = new Date(dateStr); tgt.setHours(0, 0, 0, 0)
  return Math.ceil((tgt.getTime() - today.getTime()) / 86_400_000)
}

function getSortGroup(m: CustomerMemory): number {
  if (!m.trigger_date) return 3
  const d = daysUntil(m.trigger_date)
  if (d === 0)           return 0  // 今日
  if (d > 0 && d <= 7)   return 1  // 7日以内
  if (d > 7 && d <= 30)  return 2  // 30日以内
  if (d < 0)             return 4  // 過去
  return 3                         // 30日超
}

function sortMemories(arr: CustomerMemory[]): CustomerMemory[] {
  return [...arr].sort((a, b) => {
    const gd = getSortGroup(a) - getSortGroup(b)
    if (gd !== 0) return gd
    if (a.trigger_date && b.trigger_date) {
      const dd = Math.abs(daysUntil(a.trigger_date)) - Math.abs(daysUntil(b.trigger_date))
      if (dd !== 0) return dd
    }
    const id = (IMP_ORDER[a.importance] ?? 1) - (IMP_ORDER[b.importance] ?? 1)
    if (id !== 0) return id
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function formatLine(m: CustomerMemory): string {
  if (m.trigger_date) {
    const d = daysUntil(m.trigger_date)
    if (d === 0)           return `${m.content}（今日）`
    if (d > 0 && d <= 30)  return `${m.content}まで${d}日`
  }
  return m.content
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerMemorySection({ customerId, onManage, refreshKey }: Props) {
  const [memories, setMemories] = useState<CustomerMemory[]>([])
  const [loading,  setLoading]  = useState(true)
  const [view,     setView]     = useState<'briefing' | 'add'>('briefing')
  const [form,     setForm]     = useState<FormState>({ ...EMPTY_FORM })
  const [saving,   setSaving]   = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(
        `/api/customer-memories?customer_id=${encodeURIComponent(customerId)}`
      )
      if (!res.ok) return
      const { memories: data } = await res.json() as { memories: CustomerMemory[] }
      setMemories(sortMemories(data))
    } catch { /* silent */ } finally { setLoading(false) }
  }, [customerId])

  // refreshKey が変化するたびに再フェッチ（VoiceMemoSection の onSaved からトリガー）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load, refreshKey])

  async function handleSave() {
    if (!form.content.trim()) { toast.error('内容を入力してください'); return }
    setSaving(true)
    try {
      const res = await authedFetch('/api/customer-memories', {
        method: 'POST',
        body: JSON.stringify({
          customer_id:  customerId,
          content:      form.content.trim(),
          memory_type:  form.memory_type,
          trigger_date: form.trigger_date || null,
          importance:   form.importance,
          is_sensitive: form.is_sensitive,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('保存しました')
      setForm({ ...EMPTY_FORM })
      setView('briefing')
      await load()
    } catch { toast.error('保存に失敗しました') }
    finally { setSaving(false) }
  }

  // 初回ロード中は非表示（レイアウトシフト回避）
  if (loading) return null

  const normal    = memories.filter(m => !m.is_sensitive)
  const sensitive = memories.filter(m => m.is_sensitive)

  return (
    <div
      className="rounded-[18px] overflow-hidden"
      style={{ border: '1px solid #F0E8E8', background: '#FEFCFD' }}
    >
      <AnimatePresence mode="wait" initial={false}>

        {/* ══════ BRIEFING ══════ */}
        {view === 'briefing' && (
          <motion.div
            key="briefing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <span className="text-[11px] font-bold text-[#5C4033] tracking-wide">
                💌 覚えておくこと
              </span>
              <div className="flex items-center gap-2">
                {memories.length > 0 && (
                  <button
                    onClick={onManage}
                    className="text-[10px] text-[#C8A8B0] bg-transparent border-none cursor-pointer"
                  >
                    管理
                  </button>
                )}
                <button
                  onClick={() => setView('add')}
                  className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border-none cursor-pointer"
                  style={{ background: 'rgba(245,110,139,0.10)', color: '#F56E8B' }}
                >
                  <Plus size={9} strokeWidth={3} />
                  Memory
                </button>
              </div>
            </div>

            {/* 通常メモリー */}
            <div className="px-4 pb-3 flex flex-col gap-[9px]">
              {normal.length === 0 && sensitive.length === 0 ? (
                <p className="text-[11px] text-[#C8A8B0]">まだ登録されていません</p>
              ) : (
                <>
                  {normal.slice(0, 5).map(m => {
                    const group    = getSortGroup(m)
                    const isToday  = group === 0
                    const isUrgent = group === 1
                    const isSoon   = group === 2
                    const emoji    = MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝'
                    return (
                      <div key={m.id} className="flex items-center gap-2 min-w-0">
                        <span className="text-sm flex-shrink-0">{emoji}</span>
                        <span
                          className="text-[12.5px] leading-snug flex-1 min-w-0 truncate"
                          style={{
                            color:      isToday || isUrgent ? '#C04060' : '#5C4033',
                            fontWeight: isToday ? 800 : isUrgent ? 700 : isSoon ? 600 : 400,
                          }}
                        >
                          {formatLine(m)}
                        </span>
                        {(isToday || isUrgent) && (
                          <span
                            className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(240,80,80,0.12)', color: '#C04060' }}
                          >
                            {isToday ? '今日' : `${daysUntil(m.trigger_date!)}d`}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {normal.length > 5 && (
                    <button
                      onClick={onManage}
                      className="text-[10px] text-[#C8A8B0] bg-transparent border-none cursor-pointer p-0 text-left"
                    >
                      他{normal.length - 5}件 →
                    </button>
                  )}
                </>
              )}
            </div>

            {/* ⚠ 触れない話題 */}
            {sensitive.length > 0 && (
              <div
                className="mx-3 mb-3 rounded-[12px] px-3 py-2.5"
                style={{
                  background: 'rgba(210,50,50,0.05)',
                  border:     '1px solid rgba(210,50,50,0.14)',
                }}
              >
                <p className="text-[10px] font-bold text-[#B84050] mb-1.5 tracking-wider">
                  ⚠ 触れない話題
                </p>
                <div className="flex flex-col gap-1">
                  {sensitive
                    .filter(m => m.content?.trim())
                    .map(m => (
                      <p key={m.id} className="text-[11px] text-[#884050] leading-snug">
                        ・{m.content}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ══════ ADD FORM ══════ */}
        {view === 'add' && (
          <motion.div
            key="add"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* フォームヘッダー */}
            <div
              className="flex items-center gap-2 px-4 pt-3 pb-2.5"
              style={{ borderBottom: '1px solid #F5EEF0' }}
            >
              <button
                onClick={() => { setView('briefing'); setForm({ ...EMPTY_FORM }) }}
                className="flex items-center gap-0.5 bg-transparent border-none cursor-pointer text-[#C8A58C] text-xs"
              >
                <ChevronLeft size={13} strokeWidth={2} />戻る
              </button>
              <span className="text-[11px] font-bold text-[#5C4033] tracking-wide ml-1">
                新しいメモリー
              </span>
            </div>

            <div className="px-4 py-3 flex flex-col gap-3.5">

              {/* 内容 */}
              <textarea
                value={form.content}
                onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                placeholder="例：娘さんが受験予定　ゴルフが趣味"
                rows={2}
                autoFocus
                className="w-full text-sm text-[#5C4033] placeholder-[#D4B8BC] bg-transparent border-none outline-none resize-none leading-relaxed"
                style={{ borderBottom: '1px solid #F0E8E8', paddingBottom: '8px' }}
              />

              {/* カテゴリ */}
              <div>
                <p className="text-[9px] font-medium text-[#C8A8B0] tracking-widest mb-1.5">
                  カテゴリ
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {MEMORY_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setForm(p => ({ ...p, memory_type: t }))}
                      className="text-[10px] px-2.5 py-1 rounded-full border-none cursor-pointer"
                      style={{
                        background: form.memory_type === t ? 'rgba(245,110,139,0.12)' : '#F5EEF0',
                        color:      form.memory_type === t ? '#F56E8B' : '#9F7E6C',
                        fontWeight: form.memory_type === t ? 600 : 400,
                      }}
                    >
                      {MEMORY_TYPE_EMOJI[t]}{MEMORY_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 重要度 */}
              <div>
                <p className="text-[9px] font-medium text-[#C8A8B0] tracking-widest mb-1.5">
                  重要度
                </p>
                <div className="flex gap-2">
                  {IMPORTANCES.map(imp => (
                    <button
                      key={imp}
                      onClick={() => setForm(p => ({ ...p, importance: imp }))}
                      className="flex-1 text-[10px] py-1.5 rounded-full border-none cursor-pointer"
                      style={{
                        background: form.importance === imp ? IMP_STYLE[imp].bg    : '#F5EEF0',
                        color:      form.importance === imp ? IMP_STYLE[imp].color : '#C8A8B0',
                        fontWeight: form.importance === imp ? 700 : 400,
                      }}
                    >
                      {IMPORTANCE_LABELS[imp]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 日付（任意）*/}
              <div>
                <p className="text-[9px] font-medium text-[#C8A8B0] tracking-widest mb-1.5">
                  日付（任意）
                </p>
                <input
                  type="date"
                  value={form.trigger_date}
                  onChange={e => setForm(p => ({ ...p, trigger_date: e.target.value }))}
                  className="text-[12px] text-[#5C4033] bg-transparent border-none outline-none w-full"
                  style={{ borderBottom: '1px solid #F0E8E8', paddingBottom: '4px' }}
                />
              </div>

              {/* Sensitive */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_sensitive}
                  onChange={e => setForm(p => ({ ...p, is_sensitive: e.target.checked }))}
                  className="w-3.5 h-3.5 accent-[#F56E8B]"
                />
                <span className="text-[11px] text-[#9F7E6C]">⚠ センシティブ（触れない話題）</span>
              </label>

              {/* Divider */}
              <div style={{ borderTop: '1px solid #F5EEF0' }} />

              {/* TODO: CM-3 Voice Note連携
                   実装予定: 最新 VoiceMemo を解析して Memory として取り込む
                   VoiceMemoSection との統合が必要 */}
              <button
                disabled
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full border-none cursor-not-allowed"
                style={{ background: '#F5EEF0', color: '#D4B8BC' }}
                title="CM-3で実装予定"
              >
                <Mic size={13} />
                <span className="text-[11px] font-medium">音声メモから抽出（準備中）</span>
              </button>

              {/* 保存 */}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3.5 rounded-full border-none text-sm font-bold text-white"
                style={{
                  background: saving ? '#E8D5D8' : '#F56E8B',
                  boxShadow:  saving ? 'none' : '0 6px 20px rgba(245,110,139,0.32)',
                  cursor:     saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? '保存中…' : '保存する'}
              </button>

            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}

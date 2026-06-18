'use client'
/**
 * CustomerNotesSection.tsx
 * Voice Memo → AI解析 → customer_notes から自動生成されたノートを
 * カテゴリ別に表示・編集するコンポーネント。
 * CustomerBottomSheet の上部（KPI グリッド直下）に配置する。
 */

import { useState, useEffect, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  fetchCustomerNotes,
  updateCustomerNote,
  deleteCustomerNote,
  type CustomerNote,
} from '@/lib/customerNotes'
import {
  NOTE_CATEGORY_LABELS,
  NOTE_CATEGORY_ICONS,
  type NoteCategory,
} from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface CustomerNotesSectionProps {
  customerId:  string
  refreshKey?: number
}

// ─── カテゴリ順序（表示順固定） ───────────────────────────────────────────────

const CATEGORY_ORDER: NoteCategory[] = ['Family', 'Work', 'Health', 'Preference', 'Event']

// ─── カテゴリ別カラー ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<NoteCategory, { bg: string; text: string; border: string }> = {
  Family:     { bg: '#FFF0F8', text: '#D05090', border: '#F5C6E0' },
  Work:       { bg: '#F0F5FF', text: '#4060C8', border: '#C0D0F0' },
  Health:     { bg: '#F0FFF5', text: '#30A060', border: '#B0E0C8' },
  Preference: { bg: '#FFFBF0', text: '#C08020', border: '#F0DCA0' },
  Event:      { bg: '#FFF8F0', text: '#D06020', border: '#F0C8A0' },
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

const CustomerNotesSectionInner = memo(function CustomerNotesSection({
  customerId,
  refreshKey = 0,
}: CustomerNotesSectionProps) {
  const [notes,       setNotes]       = useState<CustomerNote[]>([])
  const [loading,     setLoading]     = useState(true)
  const [collapsed,   setCollapsed]   = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editText,    setEditText]    = useState('')
  const [savingId,    setSavingId]    = useState<string | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchCustomerNotes(customerId)
    setNotes(rows)
    setLoading(false)
  }, [customerId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // カテゴリ別グルーピング
  const grouped = CATEGORY_ORDER.reduce<Record<NoteCategory, CustomerNote[]>>(
    (acc, cat) => {
      acc[cat] = notes.filter(n => n.category === cat)
      return acc
    },
    {} as Record<NoteCategory, CustomerNote[]>
  )

  const hasAny = notes.length > 0

  const startEdit = (note: CustomerNote) => {
    setEditingId(note.id)
    setEditText(note.note)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleSave = async (noteId: string) => {
    if (!editText.trim() || savingId) return
    setSavingId(noteId)
    const { error } = await updateCustomerNote(noteId, editText.trim())
    setSavingId(null)
    if (error) {
      toast.error('更新に失敗しました')
      return
    }
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, note: editText.trim() } : n))
    setEditingId(null)
    toast.success('メモを更新しました', { duration: 1500 })
  }

  const handleDelete = async (noteId: string) => {
    if (deletingId) return
    setDeletingId(noteId)
    const { error } = await deleteCustomerNote(noteId)
    setDeletingId(null)
    if (error) {
      toast.error('削除に失敗しました')
      return
    }
    setNotes(prev => prev.filter(n => n.id !== noteId))
    toast.success('削除しました', { duration: 1200 })
  }

  // ノートが0件 & ロード完了 → 非表示
  if (!loading && !hasAny) return null

  return (
    <div
      data-testid="customer-notes-section"
      style={{
        background:   '#FAF7FF',
        borderRadius: '22px',
        overflow:     'hidden',
        border:       '1px solid #EDE0FA',
      }}
    >
      {/* ヘッダー */}
      <button
        onClick={() => setCollapsed(p => !p)}
        style={{
          width:      '100%',
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding:    '13px 16px',
          background: 'transparent',
          border:     'none',
          cursor:     'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <p style={{
            fontSize:      '11px',
            letterSpacing: '0.18em',
            color:         '#7050A8',
            fontWeight:    600,
            margin:        0,
          }}>
            🧠 AIノート
          </p>
          {!loading && hasAny && (
            <span style={{
              fontSize:   '10px',
              padding:    '1px 7px',
              borderRadius: '999px',
              background: 'rgba(112,80,168,0.1)',
              color:      '#7050A8',
              fontWeight: 600,
            }}>
              {notes.length}件
            </span>
          )}
        </div>
        <span style={{
          fontSize:   '13px',
          color:      '#9070C8',
          transition: 'transform 0.2s',
          display:    'inline-block',
          transform:  collapsed ? 'none' : 'rotate(180deg)',
        }}>▾</span>
      </button>

      {/* コンテンツ */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

              {loading && (
                <p style={{ fontSize: '12px', color: '#9070C8', textAlign: 'center', padding: '6px 0' }}>
                  読み込み中…
                </p>
              )}

              {!loading && CATEGORY_ORDER.map(cat => {
                const catNotes = grouped[cat]
                if (catNotes.length === 0) return null
                const col = CATEGORY_COLORS[cat]

                return (
                  <div key={cat}>
                    {/* カテゴリラベル */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px', marginTop: '4px' }}>
                      <span style={{ fontSize: '13px' }}>{NOTE_CATEGORY_ICONS[cat]}</span>
                      <span style={{
                        fontSize:   '10px',
                        fontWeight: 700,
                        color:      col.text,
                        letterSpacing: '0.06em',
                      }}>
                        {NOTE_CATEGORY_LABELS[cat]}
                      </span>
                    </div>

                    {/* ノート一覧 */}
                    {catNotes.map(note => {
                      const isEditing  = editingId  === note.id
                      const isSaving   = savingId   === note.id
                      const isDeleting = deletingId === note.id

                      return (
                        <motion.div
                          key={note.id}
                          layout
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          style={{
                            background:   col.bg,
                            borderRadius: '14px',
                            padding:      '10px 12px',
                            border:       `1px solid ${col.border}`,
                            marginBottom: '5px',
                          }}
                        >
                          {isEditing ? (
                            /* 編集モード */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                              <textarea
                                value={editText}
                                onChange={e => setEditText(e.target.value.slice(0, 200))}
                                autoFocus
                                rows={2}
                                style={{
                                  width:        '100%',
                                  resize:       'none',
                                  fontSize:     '12px',
                                  color:        '#4A3060',
                                  background:   '#fff',
                                  borderRadius: '10px',
                                  padding:      '8px',
                                  border:       `1px solid ${col.border}`,
                                  outline:      'none',
                                  lineHeight:   1.6,
                                  boxSizing:    'border-box',
                                  fontFamily:   'inherit',
                                }}
                              />
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={cancelEdit}
                                  style={{
                                    flex:         1,
                                    padding:      '7px',
                                    borderRadius: '999px',
                                    border:       `1px solid ${col.border}`,
                                    background:   '#fff',
                                    color:        '#9070C8',
                                    fontSize:     '12px',
                                    fontWeight:   600,
                                    cursor:       'pointer',
                                  }}>
                                  キャンセル
                                </button>
                                <button
                                  onClick={() => handleSave(note.id)}
                                  disabled={isSaving}
                                  style={{
                                    flex:         2,
                                    padding:      '7px',
                                    borderRadius: '999px',
                                    border:       'none',
                                    background:   isSaving ? '#C0B0E0' : '#7050A8',
                                    color:        '#fff',
                                    fontSize:     '12px',
                                    fontWeight:   700,
                                    cursor:       isSaving ? 'default' : 'pointer',
                                  }}>
                                  {isSaving ? '保存中…' : '保存'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* 表示モード */
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                              <p style={{
                                flex:       1,
                                fontSize:   '12px',
                                color:      '#4A3060',
                                lineHeight: 1.65,
                                margin:     0,
                                wordBreak:  'break-word',
                              }}>
                                {note.note}
                              </p>
                              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                {/* 編集ボタン */}
                                <button
                                  onClick={() => startEdit(note)}
                                  style={{
                                    width:        '26px',
                                    height:       '26px',
                                    borderRadius: '50%',
                                    border:       `1px solid ${col.border}`,
                                    background:   '#fff',
                                    color:        col.text,
                                    fontSize:     '11px',
                                    cursor:       'pointer',
                                    display:      'flex',
                                    alignItems:   'center',
                                    justifyContent: 'center',
                                  }}>
                                  ✏️
                                </button>
                                {/* 削除ボタン */}
                                <button
                                  onClick={() => handleDelete(note.id)}
                                  disabled={isDeleting}
                                  style={{
                                    width:        '26px',
                                    height:       '26px',
                                    borderRadius: '50%',
                                    border:       '1px solid #F5C6D0',
                                    background:   '#FFF0F2',
                                    color:        '#C05060',
                                    fontSize:     '11px',
                                    cursor:       isDeleting ? 'default' : 'pointer',
                                    opacity:      isDeleting ? 0.5 : 1,
                                    display:      'flex',
                                    alignItems:   'center',
                                    justifyContent: 'center',
                                  }}>
                                  {isDeleting ? '…' : '×'}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* source バッジ */}
                          {note.source === 'voice_note' && !isEditing && (
                            <p style={{
                              fontSize:   '9px',
                              color:      '#9070C8',
                              marginTop:  '5px',
                              marginBottom: 0,
                            }}>
                              🎙️ 音声メモから自動生成
                            </p>
                          )}
                        </motion.div>
                      )
                    })}
                  </div>
                )
              })}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

CustomerNotesSectionInner.displayName = 'CustomerNotesSection'
export default CustomerNotesSectionInner

'use client'
/**
 * KarteMemoSection.tsx — 「📝 カルテメモ」(PHASE IPAD-3・2026-09-11)。
 *
 * customer_karte_memos(長文自由記述・時系列・編集可・スタッフ記録付き)のCRUD UI。
 * IpadStaffKarteViewの左カラムに追加する自己完結セクション。
 *
 * 見た目の操作パターン(カード一覧→編集ボタン→テキストエリア+保存/キャンセル→削除)は
 * CustomerMemoryTab.tsxを踏襲しているが、配色はIpadStaffKarteViewに合わせて
 * PhotoCompareKit.tsxのPALETTE(アイボリー×ゴールド)に統一している。
 *
 * 絶対ルール: このファイルをProposalOrchestrator/FireScore/PatternEngine/LINE提案/
 * TodayFocusCardのいずれにもimportしないこと。content参照禁止
 * (src/types/customerKarteMemo.tsの絶対ルールに準拠)。
 */
import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, Check, X } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'
import type { CustomerKarteMemo } from '@/types/customerKarteMemo'

interface Props {
  customerId: string
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function KarteMemoSection({ customerId }: Props) {
  const [memos, setMemos] = useState<CustomerKarteMemo[]>([])
  const [loading, setLoading] = useState(true)

  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [updating, setUpdating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/customer-karte-memos?customer_id=${encodeURIComponent(customerId)}`)
      if (res.ok) {
        const json = await res.json() as { memos: CustomerKarteMemo[] }
        setMemos(json.memos ?? [])
      }
    } catch { /* 取得失敗時は前回の表示を維持する */ }
    finally { setLoading(false) }
  }, [customerId])

  useEffect(() => { void load() }, [load])

  async function handleAdd() {
    if (!newContent.trim() || saving) return
    setSaving(true)
    try {
      const res = await authedFetch('/api/customer-karte-memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, content: newContent.trim() }),
      })
      if (!res.ok) throw new Error()
      setNewContent('')
      setAdding(false)
      await load()
    } catch { /* 失敗時は入力内容を保持したままにする */ }
    finally { setSaving(false) }
  }

  function startEdit(m: CustomerKarteMemo) {
    setEditingId(m.id)
    setEditContent(m.content)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditContent('')
  }

  async function handleUpdate() {
    if (!editingId || !editContent.trim() || updating) return
    setUpdating(true)
    try {
      const res = await authedFetch(`/api/customer-karte-memos/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, content: editContent.trim() }),
      })
      if (!res.ok) throw new Error()
      cancelEdit()
      await load()
    } catch { /* 失敗時は編集状態を維持する */ }
    finally { setUpdating(false) }
  }

  async function handleDelete(id: string) {
    const res = await authedFetch(`/api/customer-karte-memos/${id}?customer_id=${encodeURIComponent(customerId)}`, {
      method: 'DELETE',
    })
    if (!res.ok) return
    setMemos(prev => prev.filter(m => m.id !== id))
    if (editingId === id) cancelEdit()
  }

  return (
    <Card title="📝 カルテメモ">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {loading && (
          <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>
        )}

        {!loading && memos.length === 0 && !adding && (
          <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>まだ記録されていません</p>
        )}

        {!loading && memos.map(m => {
          const isEditing = editingId === m.id
          const edited = m.updated_at !== m.created_at

          if (isEditing) {
            return (
              <div
                key={m.id}
                style={{
                  border: `1.5px solid ${PALETTE.gold}`, borderRadius: '12px',
                  padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px',
                  background: PALETTE.card,
                }}
              >
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={4}
                  autoFocus
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
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                      border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
                      cursor: 'pointer',
                    }}
                  >
                    <X size={11} />キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpdate()}
                    disabled={updating}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
                      border: 'none', background: updating ? PALETTE.border : PALETTE.gold, color: '#fff',
                      cursor: updating ? 'default' : 'pointer',
                    }}
                  >
                    <Check size={11} />{updating ? '更新中…' : '更新する'}
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div
              key={m.id}
              style={{
                border: `1px solid ${PALETTE.border}`, borderRadius: '12px', padding: '12px',
                background: PALETTE.card, display: 'flex', flexDirection: 'column', gap: '6px',
              }}
            >
              <p style={{ margin: 0, fontSize: '13px', color: PALETTE.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.content}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <p style={{ margin: 0, fontSize: '10px', color: PALETTE.muted }}>
                  {formatDateTime(m.created_at)}
                  {m.staffName ? ` ・ ${m.staffName}` : ''}
                  {edited ? '(編集済み)' : ''}
                </p>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    aria-label="編集"
                    style={{
                      width: '26px', height: '26px', borderRadius: '50%', border: `1px solid ${PALETTE.border}`,
                      background: PALETTE.bg, color: PALETTE.gold, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(m.id)}
                    aria-label="削除"
                    style={{
                      width: '26px', height: '26px', borderRadius: '50%', border: '1px solid rgba(196,90,90,0.3)',
                      background: 'rgba(196,90,90,0.08)', color: '#B85050', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {adding ? (
          <div style={{ border: `1.5px solid ${PALETTE.gold}`, borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={4}
              autoFocus
              placeholder="今日の接客で気づいたこと、施術中の様子など自由に記録してください"
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
                onClick={() => { setAdding(false); setNewContent('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                  border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
                  cursor: 'pointer',
                }}
              >
                <X size={11} />キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
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
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              fontSize: '12px', fontWeight: 700, padding: '10px', borderRadius: '10px',
              border: `1.5px dashed ${PALETTE.border}`, background: 'transparent', color: PALETTE.gold,
              cursor: 'pointer',
            }}
          >
            <Plus size={13} strokeWidth={2.4} />カルテメモを追加
          </button>
        )}
      </div>
    </Card>
  )
}

'use client'
/**
 * VisitHistorySection.tsx — スタッフモード「📅 来店履歴」セクション(2026-09-24ユーザー承認)。
 *
 * IpadStaffKarteView(PIN保護されたスタッフモード)専用。各来店日をタップすると、
 * その日に記録されたカルテメモ(customer_karte_memos)・顔シェーマ
 * (brain_customer_facial_schemas)を展開・参照できる(閲覧専用、編集はしない。
 * 編集は上部の常時展開カルテメモ欄・顔シェーマ欄で行う想定)。
 *
 * お客様モード(CustomerModeView.tsx)側の「来店履歴」カードは元々タップ不可の
 * 閲覧専用リストであり、この機能とは無関係(このファイルを一切importしない設計を
 * 維持する。内部メモを不用意に見せないため)。
 *
 * customerId以外を受け取らない自己完結セクション(FacialSchemaViewer.tsx等と
 * 同じ設計方針)。既存の3つのAPI(visit-history・customer-karte-memos・
 * facial-schemas)を再利用するのみで新規APIは追加しない。
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, ClipboardPaste, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'
import { FacialSchemaThumbnail } from '@/components/customer/shared/FacialSchemaKit'
import type { CustomerKarteMemo } from '@/types/customerKarteMemo'
import type { FacialSchemaApiShape } from '@/lib/facialSchema/facialSchemaApiMapping'

interface Props {
  customerId: string
}

interface VisitHistoryEntry {
  id:        string
  visitDate: string
  menuName:  string | null
}

function formatDateOnly(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

/** created_at(タイムスタンプ)がvisitDate(YYYY-MM-DD)と同じ暦日かを判定する(ローカル時刻基準)。 */
function isSameLocalDate(iso: string, visitDate: string): boolean {
  const a = new Date(iso)
  const b = new Date(visitDate)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export default function VisitHistorySection({ customerId }: Props) {
  const [visits, setVisits] = useState<VisitHistoryEntry[]>([])
  const [memos, setMemos] = useState<CustomerKarteMemo[]>([])
  const [schemas, setSchemas] = useState<FacialSchemaApiShape[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null)

  // 過去カルテメモの遡及登録(2026-09-25ユーザー承認): 移行期でアプリ導入前の来店には
  // カルテメモが一件も無いため、サロンボード等からコピーした過去メモを、その来店日付きで
  // 直接ここから登録できるようにする。addingForVisitId===visit.idの間だけ入力欄を表示する。
  const [addingForVisitId, setAddingForVisitId] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [saving, setSaving] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [visitsRes, memosRes, schemasRes] = await Promise.all([
          authedFetch(`/api/customers/${customerId}/visit-history`),
          authedFetch(`/api/customer-karte-memos?customer_id=${encodeURIComponent(customerId)}`),
          authedFetch(`/api/customers/${customerId}/facial-schemas`),
        ])
        if (cancelled) return

        if (visitsRes.ok) {
          const json = await visitsRes.json() as { success: boolean; visits?: VisitHistoryEntry[] }
          setVisits(json.visits ?? [])
        }
        if (memosRes.ok) {
          const json = await memosRes.json() as { memos?: CustomerKarteMemo[] }
          setMemos(json.memos ?? [])
        }
        if (schemasRes.ok) {
          const json = await schemasRes.json() as { success: boolean; schemas?: FacialSchemaApiShape[] }
          setSchemas(json.schemas ?? [])
        }
      } catch {
        /* 取得失敗時は空一覧のまま(致命的にしない) */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  function openAddForm(visitId: string) {
    setAddingForVisitId(visitId)
    setDraftContent('')
  }

  function closeAddForm() {
    setAddingForVisitId(null)
    setDraftContent('')
  }

  function appendDraft(text: string) {
    setDraftContent(prev => {
      const trimmed = prev.trimEnd()
      return trimmed.length > 0 ? `${trimmed}\n${text}` : text
    })
    requestAnimationFrame(() => {
      const el = draftRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('クリップボードにテキストがありません')
        return
      }
      appendDraft(text)
      toast.success('クリップボードから貼り付けました', { duration: 1500 })
    } catch {
      toast.error('自動貼り付けができませんでした。入力欄を長押しして貼り付けてください')
      requestAnimationFrame(() => draftRef.current?.focus())
    }
  }

  async function handleSaveDraft(visit: VisitHistoryEntry) {
    if (!draftContent.trim() || saving) return
    setSaving(true)
    try {
      const res = await authedFetch('/api/customer-karte-memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          content: draftContent.trim(),
          memo_date: visit.visitDate,
        }),
      })
      if (!res.ok) throw new Error()
      const json = await res.json() as { memo?: CustomerKarteMemo }
      if (json.memo) setMemos(prev => [json.memo as CustomerKarteMemo, ...prev])
      toast.success('この来店日のカルテメモを登録しました', { duration: 1500 })
      closeAddForm()
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card title="📅 来店履歴">
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>
      </Card>
    )
  }

  if (visits.length === 0) {
    return (
      <Card title="📅 来店履歴">
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>来店記録がありません</p>
      </Card>
    )
  }

  return (
    <Card title="📅 来店履歴">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {visits.map((visit, i) => {
          const visitNumber = visits.length - i
          const isExpanded = expandedVisitId === visit.id
          const dayMemos = memos.filter(m => isSameLocalDate(m.created_at, visit.visitDate))
          const daySchema = schemas.find(s => s.schemaDate === visit.visitDate) ?? null

          return (
            <div key={visit.id} style={{ border: `1px solid ${PALETTE.border}`, borderRadius: '10px', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setExpandedVisitId(isExpanded ? null : visit.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 12px', border: 'none', background: PALETTE.card,
                  color: PALETTE.text, fontSize: '13px', cursor: 'pointer', textAlign: 'left',
                }}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ fontWeight: 700 }}>来店{visitNumber}回目</span>
                <span style={{ color: PALETTE.muted, fontSize: '12px' }}>
                  {[formatDateOnly(visit.visitDate), visit.menuName].filter(Boolean).join(' ・ ')}
                </span>
              </button>

              {isExpanded && (
                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: `1px solid ${PALETTE.border}` }}>
                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: PALETTE.muted }}>この日のカルテメモ</p>
                    {dayMemos.length === 0 && addingForVisitId !== visit.id && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>記録がありません</p>
                        <button
                          type="button"
                          onClick={() => openAddForm(visit.id)}
                          style={{
                            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '999px',
                            border: `1.5px dashed ${PALETTE.gold}`, background: 'transparent', color: PALETTE.gold,
                            cursor: 'pointer',
                          }}
                        >
                          <Plus size={13} strokeWidth={2.4} />この来店日のメモを追加(サロンボードから貼り付け)
                        </button>
                      </div>
                    )}

                    {addingForVisitId === visit.id && (
                      <div style={{ border: `1.5px solid ${PALETTE.gold}`, borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => void handlePasteFromClipboard()}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                            fontSize: '13px', fontWeight: 700, padding: '10px', borderRadius: '10px',
                            border: `1.5px dashed ${PALETTE.gold}`, background: 'transparent', color: PALETTE.gold,
                            cursor: 'pointer',
                          }}
                        >
                          <ClipboardPaste size={15} />サロンボードのメモを貼り付け
                        </button>
                        <textarea
                          ref={draftRef}
                          value={draftContent}
                          onChange={e => setDraftContent(e.target.value)}
                          rows={8}
                          autoFocus
                          placeholder={`${formatDateOnly(visit.visitDate)}のカルテメモ(サロンボードからコピーした内容を貼り付け、または直接入力)`}
                          style={{
                            width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '160px',
                            fontSize: '14px', color: PALETTE.text, lineHeight: 1.7,
                            border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px',
                            outline: 'none', fontFamily: 'inherit',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={closeAddForm}
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
                            onClick={() => void handleSaveDraft(visit)}
                            disabled={saving || !draftContent.trim()}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              fontSize: '11px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
                              border: 'none', background: (saving || !draftContent.trim()) ? PALETTE.border : PALETTE.gold, color: '#fff',
                              cursor: (saving || !draftContent.trim()) ? 'default' : 'pointer',
                            }}
                          >
                            <Check size={11} />{saving ? '保存中…' : 'この日のメモとして保存する'}
                          </button>
                        </div>
                      </div>
                    )}

                    {dayMemos.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {dayMemos.map(memo => (
                          <div key={memo.id} style={{ border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px', background: PALETTE.bg }}>
                            <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {memo.content}
                            </p>
                            <p style={{ margin: '4px 0 0', fontSize: '10px', color: PALETTE.muted }}>
                              {formatTime(memo.created_at)}{memo.staffName ? ` ・ ${memo.staffName}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 700, color: PALETTE.muted }}>この日の顔シェーマ</p>
                    {daySchema ? (
                      <div style={{ maxWidth: '200px' }}>
                        <FacialSchemaThumbnail strokesData={daySchema.strokesData} />
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>記録がありません</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

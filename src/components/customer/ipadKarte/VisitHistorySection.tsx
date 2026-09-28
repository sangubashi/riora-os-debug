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
 * customerId以外に、来店履歴一覧(visits)をpropsで受け取る(PERF-KARTE-DEDUP-1・
 * 2026-09-27ユーザー承認)。visitsは親のIpadStaffKarteViewが既にuseIpadKarteData()で
 * 取得済みのため、このセクション側で同じ/api/customers/[id]/visit-historyを
 * 再フェッチしない(旧設計は自己完結fetchだったため二重リクエストが発生していた)。
 * customer-karte-memos・facial-schemasの2APIは、KarteMemoSection.tsx/
 * FacialSchemaSection.tsx側のCRUD状態管理には触れない方針のため、このセクション
 * 独自に引き続き取得する(この2件については二重フェッチが残る、既知のトレードオフ)。
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, ClipboardPaste, Check, X, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'
import { FacialSchemaThumbnail } from '@/components/customer/shared/FacialSchemaKit'
import type { CustomerKarteMemo } from '@/types/customerKarteMemo'
import type { FacialSchemaApiShape } from '@/lib/facialSchema/facialSchemaApiMapping'
import type { VisitHistoryEntry } from './ipadKarteData'
import TreatmentCourseEditModal from './TreatmentCourseEditModal'
import TreatmentOptionEditModal from './TreatmentOptionEditModal'

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

interface VisitTreatmentInfo {
  visitId:       string
  courseOptions: string[]
  optionItems:   string[]
}

interface Props {
  customerId: string
  visits:     VisitHistoryEntry[]
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

export default function VisitHistorySection({ customerId, visits }: Props) {
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

  // 過去来店のコース・オプション編集(2026-09-28ユーザー承認): 展開中のvisitのみ、
  // GET /visits/[visitId]/treatment で現在の選択状態を取得する(一覧全体を先読みはしない)。
  const [treatmentInfo, setTreatmentInfo] = useState<VisitTreatmentInfo | null>(null)
  const [treatmentLoading, setTreatmentLoading] = useState(false)
  const [editingCourseVisitId, setEditingCourseVisitId] = useState<string | null>(null)
  const [editingOptionVisitId, setEditingOptionVisitId] = useState<string | null>(null)

  useEffect(() => {
    setTreatmentInfo(null)
    if (!expandedVisitId) return
    let cancelled = false
    setTreatmentLoading(true)
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}/visits/${expandedVisitId}/treatment`)
        if (cancelled) return
        if (res.ok) {
          const json = await res.json() as {
            success: boolean
            treatment?: { visitId: string; courseOptions?: unknown; optionItems?: unknown }
          }
          if (json.success && json.treatment) {
            setTreatmentInfo({
              visitId:       json.treatment.visitId,
              courseOptions: toStringList(json.treatment.courseOptions),
              optionItems:   toStringList(json.treatment.optionItems),
            })
          }
        }
      } catch {
        /* 取得失敗時は編集ボタンごと表示しない(致命的にしない) */
      } finally {
        if (!cancelled) setTreatmentLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [customerId, expandedVisitId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [memosRes, schemasRes] = await Promise.all([
          authedFetch(`/api/customer-karte-memos?customer_id=${encodeURIComponent(customerId)}`),
          authedFetch(`/api/customers/${customerId}/facial-schemas`),
        ])
        if (cancelled) return

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
                  {[
                    formatDateOnly(visit.visitDate),
                    visit.menuName,
                    // 来店履歴サマリー表示改善(2026-09-28ユーザー承認): 担当スタッフ名を
                    // 一目で確認できるよう折りたたみ行にも追加(タップして展開しなくても
                    // 日付・施術・担当が分かるようにする)。
                    visit.staffName ? `担当 ${visit.staffName}` : null,
                  ].filter(Boolean).join(' ・ ')}
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: PALETTE.muted }}>この日の施術コース・オプション</p>
                      {treatmentInfo && treatmentInfo.visitId === visit.id && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setEditingCourseVisitId(visit.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px',
                              border: `1px solid ${PALETTE.border}`, borderRadius: '999px',
                              background: 'none', color: PALETTE.muted, fontSize: '11px', cursor: 'pointer',
                            }}
                          >
                            <Pencil size={11} strokeWidth={2} />メインコース
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOptionVisitId(visit.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px',
                              border: `1px solid ${PALETTE.border}`, borderRadius: '999px',
                              background: 'none', color: PALETTE.muted, fontSize: '11px', cursor: 'pointer',
                            }}
                          >
                            <Pencil size={11} strokeWidth={2} />追加オプション
                          </button>
                        </div>
                      )}
                    </div>
                    {treatmentLoading ? (
                      <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>
                    ) : treatmentInfo && treatmentInfo.visitId === visit.id ? (
                      (treatmentInfo.courseOptions.length === 0 && treatmentInfo.optionItems.length === 0) ? (
                        <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>未選択です</p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {[...treatmentInfo.courseOptions, ...treatmentInfo.optionItems].map((label, i) => (
                            <span
                              key={`${label}-${i}`}
                              style={{
                                fontSize: '11px', color: PALETTE.text, background: PALETTE.bg,
                                border: `1px solid ${PALETTE.border}`, borderRadius: '999px', padding: '5px 12px',
                              }}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )
                    ) : (
                      <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>取得できませんでした</p>
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

      {editingCourseVisitId && treatmentInfo && treatmentInfo.visitId === editingCourseVisitId && (
        <TreatmentCourseEditModal
          customerId={customerId}
          visitId={editingCourseVisitId}
          existing={treatmentInfo.courseOptions}
          onClose={() => setEditingCourseVisitId(null)}
          onSaved={(_visitId, courseOptions) => {
            setTreatmentInfo(prev => (prev ? { ...prev, courseOptions } : prev))
            setEditingCourseVisitId(null)
          }}
        />
      )}
      {editingOptionVisitId && treatmentInfo && treatmentInfo.visitId === editingOptionVisitId && (
        <TreatmentOptionEditModal
          customerId={customerId}
          visitId={editingOptionVisitId}
          existing={treatmentInfo.optionItems}
          onClose={() => setEditingOptionVisitId(null)}
          onSaved={(_visitId, optionItems) => {
            setTreatmentInfo(prev => (prev ? { ...prev, optionItems } : prev))
            setEditingOptionVisitId(null)
          }}
        />
      )}
    </Card>
  )
}

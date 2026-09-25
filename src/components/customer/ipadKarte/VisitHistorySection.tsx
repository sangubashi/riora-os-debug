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
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Quote } from 'lucide-react'
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

/**
 * 過去カルテメモの引用機能(2026-09-25ユーザー承認): このセクションは
 * customerId以外を受け取らない自己完結設計(ファイル冒頭コメント参照)のため、
 * 上部の常時展開カルテメモ欄(KarteMemoSection.tsx、別コンポーネント)の入力欄へ
 * 直接挿入する経路は持たない。代わりにクリップボードへコピーし、スタッフが
 * 手動で貼り付けられるようにする(Toast表示で完了を伝える)。
 */
async function copyMemoToClipboard(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    toast.success('カルテメモをコピーしました', { duration: 1500 })
  } catch {
    toast.error('コピーに失敗しました')
  }
}

export default function VisitHistorySection({ customerId }: Props) {
  const [visits, setVisits] = useState<VisitHistoryEntry[]>([])
  const [memos, setMemos] = useState<CustomerKarteMemo[]>([])
  const [schemas, setSchemas] = useState<FacialSchemaApiShape[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null)

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
                    {dayMemos.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>記録がありません</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {dayMemos.map(memo => (
                          <div key={memo.id} style={{ border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px', background: PALETTE.bg }}>
                            <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {memo.content}
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
                              <p style={{ margin: 0, fontSize: '10px', color: PALETTE.muted }}>
                                {formatTime(memo.created_at)}{memo.staffName ? ` ・ ${memo.staffName}` : ''}
                              </p>
                              <button
                                type="button"
                                onClick={() => void copyMemoToClipboard(memo.content)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                                  fontSize: '11px', fontWeight: 700, padding: '6px 12px', borderRadius: '999px',
                                  border: `1px solid ${PALETTE.gold}`, background: 'none', color: PALETTE.gold, cursor: 'pointer',
                                }}
                              >
                                <Quote size={11} />引用(コピー)
                              </button>
                            </div>
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

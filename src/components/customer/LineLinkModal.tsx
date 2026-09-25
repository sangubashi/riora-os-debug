'use client'
/**
 * LineLinkModal.tsx — 顧客とLINE User IDの紐付け/解除モーダル(カルテアプリ専用、STEP 1新設)。
 *
 * PATCH /api/customers/[id]/line-link を叩くだけの薄いUI。既存のLINE基盤
 * (line_user_ids・sendLineMessage・lineAdminQueries.ts等)には一切手を加えない。
 * 表示名は検索の絞り込みにのみ使い、最終的な紐付けキーは常にline_user_id
 * (一覧から明示的に選んだ行のline_user_id)を使用する。名前による自動紐付けは行わない。
 */
import { useCallback, useEffect, useState } from 'react'
import { X, Search, Check, Unlink } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

interface Candidate {
  lineUserId:  string
  displayName: string | null
  followedAt:  string
  isFollowing: boolean
}

interface Props {
  customerId:        string
  currentLineUserId: string | null
  onClose:           () => void
  onChanged:         (result: { linked: boolean; lineUserId: string | null; displayName: string | null }) => void
}

export default function LineLinkModal({ customerId, currentLineUserId, onClose, onChanged }: Props) {
  const [query, setQuery]           = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null) // 処理中のlineUserId('unlink'は解除中)
  const [error, setError]           = useState<string | null>(null)

  const fetchCandidates = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = `/api/customers/${customerId}/line-link${q ? `?q=${encodeURIComponent(q)}` : ''}`
      const res = await authedFetch(url)
      if (!res.ok) {
        setError('候補の取得に失敗しました')
        return
      }
      const json = await res.json() as { candidates?: Candidate[] }
      setCandidates(json.candidates ?? [])
    } catch {
      setError('候補の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { void fetchCandidates(query) }, [fetchCandidates])

  useEffect(() => {
    const timer = setTimeout(() => { void fetchCandidates(query) }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回はfetchCandidates自体の変更(customerId変更)で発火、以降はquery入力のdebounce専用
  }, [query])

  async function submitLink(lineUserId: string | null) {
    setSubmitting(lineUserId ?? 'unlink')
    setError(null)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/line-link`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId }),
      })
      const json = await res.json() as { success: boolean; linked?: boolean; lineUserId?: string | null; displayName?: string | null; error?: string }
      if (!res.ok || !json.success) {
        setError(
          json.error === 'already_linked_to_other_customer' ? 'このLINEアカウントは既に別の顧客に紐付いています'
          : json.error === 'line_user_not_found'             ? '選択したLINEアカウントが見つかりませんでした'
          : '保存に失敗しました'
        )
        return
      }
      onChanged({ linked: json.linked ?? false, lineUserId: json.lineUserId ?? null, displayName: json.displayName ?? null })
      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: PALETTE.card, borderRadius: '16px', width: '100%', maxWidth: '440px',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: PALETTE.shadow,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${PALETTE.border}` }}>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            LINEアカウントと紐付ける
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '14px 20px 0' }}>
          {currentLineUserId && (
            <button
              type="button"
              onClick={() => void submitLink(null)}
              disabled={submitting !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', width: '100%', justifyContent: 'center',
                padding: '9px 14px', borderRadius: '10px', border: `1px solid ${PALETTE.border}`,
                background: 'none', color: '#B85050', fontSize: '13px', fontWeight: 700, cursor: submitting ? 'default' : 'pointer',
                marginBottom: '12px',
              }}
            >
              <Unlink size={14} /> {submitting === 'unlink' ? '解除中…' : '現在の紐付けを解除する'}
            </button>
          )}

          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: PALETTE.muted }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="表示名で検索"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', borderRadius: '10px',
                border: `1px solid ${PALETTE.border}`, fontSize: '13px', color: PALETTE.text, outline: 'none',
              }}
            />
          </div>

          {error && <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#B85050' }}>{error}</p>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
          {loading ? (
            <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted, textAlign: 'center', padding: '20px 0' }}>読み込み中…</p>
          ) : candidates.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted, textAlign: 'center', padding: '20px 0' }}>
              未紐付けのLINEアカウントが見つかりません
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {candidates.map(c => (
                <button
                  key={c.lineUserId}
                  type="button"
                  onClick={() => void submitLink(c.lineUserId)}
                  disabled={submitting !== null}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    padding: '10px 12px', borderRadius: '10px', border: `1px solid ${PALETTE.border}`,
                    background: 'none', cursor: submitting ? 'default' : 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: PALETTE.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.displayName || '(表示名なし)'}
                    </span>
                    <span style={{ fontSize: '11px', color: PALETTE.muted }}>
                      {c.isFollowing ? '友だち追加中' : 'ブロック/未フォロー'}
                    </span>
                  </span>
                  {submitting === c.lineUserId
                    ? <span style={{ fontSize: '11px', color: PALETTE.muted, flexShrink: 0 }}>処理中…</span>
                    : <Check size={16} style={{ color: PALETTE.gold, flexShrink: 0 }} />
                  }
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

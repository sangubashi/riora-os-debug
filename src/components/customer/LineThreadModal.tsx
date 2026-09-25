'use client'
/**
 * LineThreadModal.tsx — 顧客専用LINE会話表示モーダル(カルテアプリ専用、STEP 1新設)。
 *
 * データ取得: GET /api/customers/[id]/line-thread(既存のgetLineThreadMessages()を
 * そのまま再利用するAPI)。送信: 既存の POST /api/line/send をそのまま呼ぶ
 * (送信ロジック自体は複製しない)。LINE公式アカウント管理画面を開く実装ではない。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Send } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

interface ThreadMessage {
  id:        string
  message:   string
  direction: 'incoming' | 'outgoing'
  status:    string
  sentAt:    string
}

interface Props {
  customerId:   string
  customerName: string
  onClose:      () => void
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default function LineThreadModal({ customerId, customerName, onClose }: Props) {
  const [messages, setMessages]     = useState<ThreadMessage[]>([])
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [linked, setLinked]         = useState(true)
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [draft, setDraft]           = useState('')
  const [sending, setSending]       = useState(false)
  const [sendError, setSendError]   = useState<string | null>(null)
  const scrollRef                   = useRef<HTMLDivElement>(null)

  const fetchThread = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/line-thread`)
      if (!res.ok) {
        setLoadError('会話の取得に失敗しました')
        return
      }
      const json = await res.json() as {
        linked?: boolean; displayName?: string | null; messages?: ThreadMessage[]
      }
      setLinked(json.linked ?? false)
      setDisplayName(json.displayName ?? null)
      setMessages(json.messages ?? [])
    } catch {
      setLoadError('会話の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { void fetchThread() }, [fetchThread])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function handleSend() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await authedFetch('/api/line/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, body }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setSendError(
          json.error === 'line_user_id_not_found'  ? '送信先のLINEアカウントが見つかりません(未フォロー/未紐付けの可能性)'
          : json.error === 'duplicate_send_blocked' ? '短時間に連続送信されたため送信をブロックしました。少し待って再度お試しください'
          : json.error === 'forbidden'              ? 'この顧客へのLINE送信権限がありません'
          : '送信に失敗しました'
        )
        return
      }
      setDraft('')
      await fetchThread()
    } catch {
      setSendError('送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: PALETTE.card, borderRadius: '16px', width: '100%', maxWidth: '480px',
          height: 'min(680px, 85vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: PALETTE.shadow,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${PALETTE.border}`, flexShrink: 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: '11px', color: PALETTE.gold, letterSpacing: '0.06em' }}>LINE</p>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
              {displayName || customerName}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loading ? (
            <p style={{ margin: 'auto', fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>
          ) : loadError ? (
            <p style={{ margin: 'auto', fontSize: '13px', color: '#B85050' }}>{loadError}</p>
          ) : !linked ? (
            <p style={{ margin: 'auto', fontSize: '13px', color: PALETTE.muted, textAlign: 'center' }}>
              この顧客とLINEアカウントの紐付けがまだありません。
            </p>
          ) : messages.length === 0 ? (
            <p style={{ margin: 'auto', fontSize: '13px', color: PALETTE.muted }}>まだメッセージのやり取りがありません</p>
          ) : (
            messages.map(m => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.direction === 'outgoing' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '75%', padding: '9px 13px', borderRadius: '14px', fontSize: '13.5px', lineHeight: 1.5,
                    wordBreak: 'break-word',
                    background: m.direction === 'outgoing' ? PALETTE.gold : PALETTE.bg,
                    color: m.direction === 'outgoing' ? '#fff' : PALETTE.text,
                    borderBottomRightRadius: m.direction === 'outgoing' ? '4px' : '14px',
                    borderBottomLeftRadius:  m.direction === 'outgoing' ? '14px' : '4px',
                  }}
                >
                  {m.message}
                </div>
                <span style={{ fontSize: '10px', color: PALETTE.muted, marginTop: '2px' }}>{formatTime(m.sentAt)}</span>
              </div>
            ))
          )}
        </div>

        <div style={{ borderTop: `1px solid ${PALETTE.border}`, padding: '12px 16px', flexShrink: 0 }}>
          {sendError && <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#B85050' }}>{sendError}</p>}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={linked ? 'メッセージを入力' : 'LINEアカウントと紐付けると送信できます'}
              disabled={!linked || sending}
              rows={2}
              style={{
                flex: 1, resize: 'none', boxSizing: 'border-box', padding: '9px 12px', borderRadius: '12px',
                border: `1px solid ${PALETTE.border}`, fontSize: '13px', color: PALETTE.text, outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!linked || sending || draft.trim().length === 0}
              aria-label="送信"
              style={{
                width: '40px', height: '40px', borderRadius: '50%', border: 'none', flexShrink: 0,
                background: (!linked || sending || draft.trim().length === 0) ? PALETTE.border : PALETTE.gold,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: (!linked || sending || draft.trim().length === 0) ? 'default' : 'pointer',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

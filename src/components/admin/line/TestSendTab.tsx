'use client'
/**
 * TestSendTab.tsx — Pass S-1 LINE 実通信テスト送信パネル
 *
 * ENV.LINE_TEST_USER_ID 宛に任意メッセージを送信し、
 * 結果を line_send_logs から取得して表示する。
 * 顧客配信は行わない（1対1テスト専用）。
 */
import { useState, useEffect, useCallback } from 'react'
import { Send, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react'

interface SendLog {
  id: string
  message_body: string
  status: 'success' | 'failed'
  sent_at: string
  metadata: Record<string, unknown> | null
}

interface SendResult {
  ok: boolean
  message?: string
  logId?: string | null
  sentAt?: string
  error?: string
}

const DEFAULT_MESSAGE = '【Riora OS テスト送信】\nこれは LINE 送信機能のテストメッセージです。\nこのメッセージが届いていれば接続成功です。'

export default function TestSendTab() {
  const [messageBody, setMessageBody]   = useState(DEFAULT_MESSAGE)
  const [sending, setSending]           = useState(false)
  const [lastResult, setLastResult]     = useState<SendResult | null>(null)
  const [logs, setLogs]                 = useState<SendLog[]>([])
  const [logsLoading, setLogsLoading]   = useState(false)

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const res  = await fetch('/api/line/send-logs')
      const json = await res.json() as { ok: boolean; logs?: SendLog[] }
      if (json.ok && json.logs) setLogs(json.logs)
    } catch {
      // ログ取得失敗は無視（送信機能は影響なし）
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleSend = async () => {
    if (sending || !messageBody.trim()) return
    setSending(true)
    setLastResult(null)
    try {
      const res  = await fetch('/api/line/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_body: messageBody }),
      })
      const json = await res.json() as SendResult
      setLastResult(json)
      if (json.ok) {
        await fetchLogs()
      }
    } catch (e) {
      setLastResult({ ok: false, error: String(e) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* 送信先表示 */}
      <div style={{
        background: '#F0FAF3', border: '1px solid #86EFAC', borderRadius: '12px', padding: '12px 16px',
        fontSize: '12px', color: '#15803d', lineHeight: 1.7,
      }}>
        <strong>送信先:</strong> <code style={{ fontFamily: 'monospace' }}>LINE_TEST_USER_ID</code>（ENV 固定・顧客配信は行いません）<br />
        <strong>経路:</strong> POST /api/line/test-send → LINE Push API → 自分の LINE
      </div>

      {/* メッセージ入力 */}
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #F5EEF0', fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>
          送信メッセージ
        </div>
        <div style={{ padding: '12px 14px' }}>
          <textarea
            value={messageBody}
            onChange={e => setMessageBody(e.target.value)}
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px', borderRadius: '10px',
              border: '1px solid #E8D4D8', fontSize: '13px', color: '#3d2218',
              fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6,
              outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !messageBody.trim()}
            style={{
              marginTop: '10px', width: '100%', padding: '12px',
              borderRadius: '12px', border: 'none',
              background: sending ? '#E8D4D8' : '#06C755',
              color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: sending ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <Send size={15} />
            {sending ? '送信中...' : '自分の LINE へ送信'}
          </button>
        </div>
      </div>

      {/* 送信結果 */}
      {lastResult && (
        <div style={{
          borderRadius: '12px', padding: '12px 14px',
          background: lastResult.ok ? '#F0FAF3' : '#FEF2F2',
          border: `1px solid ${lastResult.ok ? '#86EFAC' : '#FCA5A5'}`,
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          fontSize: '12px',
        }}>
          {lastResult.ok
            ? <CheckCircle2 size={15} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
            : <XCircle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
          }
          <div>
            <p style={{ fontWeight: 700, color: lastResult.ok ? '#15803d' : '#b91c1c' }}>
              {lastResult.ok ? '送信成功 — LINE を確認してください' : `送信失敗: ${lastResult.error}`}
            </p>
            {lastResult.logId && (
              <p style={{ color: '#9F7E6C', marginTop: '2px' }}>
                ログ ID: <code style={{ fontFamily: 'monospace' }}>{lastResult.logId}</code>
              </p>
            )}
          </div>
        </div>
      )}

      {/* 送信ログ */}
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid #F5EEF0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>
            line_send_logs（最新 20 件）
          </span>
          <button
            onClick={fetchLogs}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C8A8B0', display: 'flex' }}
          >
            <RefreshCw size={13} className={logsLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {logsLoading && (
          <p style={{ padding: '16px', fontSize: '12px', color: '#C8A8B0' }}>読み込み中...</p>
        )}
        {!logsLoading && logs.length === 0 && (
          <p style={{ padding: '20px', textAlign: 'center', fontSize: '12px', color: '#C8A8B0' }}>
            送信履歴なし
          </p>
        )}
        {!logsLoading && logs.map(log => (
          <div
            key={log.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '10px 14px', borderBottom: '1px solid #FAF3F4',
            }}
          >
            {log.status === 'success'
              ? <CheckCircle2 size={14} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
              : <XCircle     size={14} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700,
                  color: log.status === 'success' ? '#15803d' : '#b91c1c',
                  background: log.status === 'success' ? '#F0FAF3' : '#FEF2F2',
                  padding: '2px 7px', borderRadius: '99px',
                }}>
                  {log.status === 'success' ? '成功' : '失敗'}
                </span>
                <span style={{ fontSize: '10px', color: '#C8A8B0', display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                  <Clock size={9} />
                  {new Date(log.sent_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p style={{
                fontSize: '11px', color: '#5C4033', marginTop: '4px',
                whiteSpace: 'pre-line',
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {log.message_body}
              </p>
              {!!log.metadata?.direction && (
                <span style={{ fontSize: '10px', color: '#C8A8B0' }}>
                  {log.metadata.direction === 'incoming' ? '受信' : '送信'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}

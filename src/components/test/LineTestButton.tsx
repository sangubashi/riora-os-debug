'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export default function LineTestButton() {
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (sending) return
    setSending(true)
    try {
      const res  = await fetch('/api/line/test-send', { method: 'POST' })
      const json = await res.json() as { ok: boolean; error?: string }
      if (json.ok) {
        toast.success('LINE テスト送信 成功 ✅')
      } else {
        toast.error(`送信失敗: ${json.error ?? '不明なエラー'}`)
      }
    } catch (e) {
      toast.error(`エラー: ${String(e)}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <button
      onClick={handleSend}
      disabled={sending}
      style={{
        width:        '100%',
        padding:      '13px',
        borderRadius: '12px',
        border:       'none',
        background:   sending ? '#E8D4D8' : '#06C755',
        color:        '#fff',
        fontSize:     '14px',
        fontWeight:   700,
        cursor:       sending ? 'not-allowed' : 'pointer',
      }}
    >
      {sending ? '送信中...' : '📨 LINE テスト送信'}
    </button>
  )
}

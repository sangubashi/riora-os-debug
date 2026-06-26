'use client'
/**
 * DeliveryHistoryTab.tsx — 配信履歴(Pass G)
 */
import { useEffect } from 'react'
import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useLineAdminStore } from '@/store/useLineAdminStore'
import { LoadingRow, EmptyRow } from './LineScreen'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_LABEL: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  sent: { label: '送信成功', color: '#34D399', icon: CheckCircle2 },
  failed: { label: '送信失敗', color: '#D14F4F', icon: XCircle },
  pending: { label: '承認待ち', color: '#C8A8B0', icon: Clock },
  approved: { label: '承認済み(送信前)', color: '#9F7E6C', icon: Clock },
  skipped: { label: 'スキップ', color: '#C8A8B0', icon: Clock },
}

export default function DeliveryHistoryTab() {
  const { history, isLoadingHistory, historyError, fetchHistory } = useLineAdminStore()

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', minHeight: '300px' }}>
      {isLoadingHistory && <LoadingRow />}
      {historyError && <p style={{ padding: '16px', fontSize: '12px', color: '#D14F4F' }}>取得エラー: {historyError}</p>}
      {!isLoadingHistory && !historyError && history.length === 0 && <EmptyRow message="LINE履歴なし" />}
      {!isLoadingHistory && history.map((h) => {
        const meta = STATUS_LABEL[h.status] ?? { label: h.status, color: '#9F7E6C', icon: Clock }
        const Icon = meta.icon
        return (
          <div key={h.id} style={{ padding: '12px 16px', borderBottom: '1px solid #FAF3F4' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>{h.customerName}</p>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: meta.color }}>
                <Icon size={12} /> {meta.label}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#5C4033', marginTop: '4px', whiteSpace: 'pre-line' }}>{h.messageBody}</p>
            {h.errorMessage && <p style={{ fontSize: '11px', color: '#D14F4F', marginTop: '4px' }}>エラー: {h.errorMessage}</p>}
            <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '4px' }}>
              送信先: {h.lineUserId} ・ 送信: {formatDateTime(h.sentAt)} ・ モード: {h.sendMode}
            </p>
          </div>
        )
      })}
    </div>
  )
}

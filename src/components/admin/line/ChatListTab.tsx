'use client'
/**
 * ChatListTab.tsx — チャット一覧+顧客別トーク(Pass G)
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, UserCircle2 } from 'lucide-react'
import { useLineAdminStore } from '@/store/useLineAdminStore'
import { LoadingRow, EmptyRow } from './LineScreen'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ChatListTab() {
  const { threads, isLoadingThreads, threadsError, fetchThreads, activeMessages, isLoadingMessages, fetchThreadMessages } = useLineAdminStore()
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetchThreads()
  }, [fetchThreads])

  useEffect(() => {
    if (selected) fetchThreadMessages(selected)
  }, [selected, fetchThreadMessages])

  if (selected) {
    const thread = threads.find((t) => t.recipientId === selected)
    return (
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', minHeight: '300px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid #F5EEF0' }}>
          <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9F7E6C', display: 'flex' }}>
            <ArrowLeft size={16} />
          </button>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>{thread?.customerName ?? thread?.displayName ?? '未紐付けLINEユーザー'}</p>
          {thread && !thread.isFollowing && <span style={{ fontSize: '10px', color: '#C8A8B0' }}>フォロー解除済み</span>}
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoadingMessages && <LoadingRow />}
          {!isLoadingMessages && activeMessages.length === 0 && <EmptyRow message="LINE履歴なし" />}
          {!isLoadingMessages && activeMessages.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'outgoing' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%', padding: '8px 12px', borderRadius: '14px', fontSize: '12px', whiteSpace: 'pre-line',
                background: m.direction === 'outgoing' ? '#D98292' : '#F5EEF0',
                color: m.direction === 'outgoing' ? '#fff' : '#5C4033',
              }}>
                <p>{m.message}</p>
                <p style={{ fontSize: '9px', marginTop: '4px', opacity: 0.7 }}>{formatDateTime(m.sentAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', minHeight: '300px' }}>
      {isLoadingThreads && <LoadingRow />}
      {threadsError && <p style={{ padding: '16px', fontSize: '12px', color: '#D14F4F' }}>取得エラー: {threadsError}</p>}
      {!isLoadingThreads && !threadsError && threads.length === 0 && <EmptyRow message="LINE履歴なし" />}
      {!isLoadingThreads && threads.map((t) => (
        <button
          key={t.recipientId}
          onClick={() => setSelected(t.recipientId)}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
            padding: '12px 16px', borderBottom: '1px solid #FAF3F4', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <UserCircle2 size={28} color="#C8A8B0" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>
                {t.customerName ?? t.displayName ?? '未紐付けLINEユーザー'}
                {!t.isFollowing && <span style={{ fontSize: '9px', color: '#C8A8B0', marginLeft: '6px' }}>フォロー解除済み</span>}
              </p>
              <p style={{ fontSize: '10px', color: '#C8A8B0', flexShrink: 0 }}>{formatDateTime(t.lastAt)}</p>
            </div>
            <p style={{ fontSize: '11px', color: '#9F7E6C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.lastDirection === 'outgoing' ? '送信: ' : '受信: '}{t.lastMessage}
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}

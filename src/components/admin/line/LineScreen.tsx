'use client'
/**
 * LineScreen.tsx — LINE画面本物化(Pass G・MD-7想定)
 *
 * 設計根拠: docs/LINE画面_DB調査レポート.md
 *
 * チャット一覧・顧客別トーク・配信履歴・テンプレート管理を実データのみで表示する。
 * 顧客に紐付く実メッセージは現状0件(line_logsの架空データは使わない・
 * webhookのmessageイベント受信は本タスクで実装済みのため今後は実データが積み上がる)。
 */
import { useState } from 'react'
import { MessageCircle, Send, FileText, Loader2 } from 'lucide-react'
import ChatListTab from './ChatListTab'
import DeliveryHistoryTab from './DeliveryHistoryTab'
import TemplateManagerTab from './TemplateManagerTab'

type TabKey = 'chat' | 'history' | 'templates'

const TABS: { key: TabKey; label: string; icon: typeof MessageCircle }[] = [
  { key: 'chat', label: 'チャット', icon: MessageCircle },
  { key: 'history', label: '配信履歴', icon: Send },
  { key: 'templates', label: 'テンプレート', icon: FileText },
]

export default function LineScreen() {
  const [tab, setTab] = useState<TabKey>('chat')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '820px' }}>
      <div>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#C8A8B0' }}>画面⑦ LINE</p>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#5C4033' }}>LINE</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>実データのみを表示します(モック・ダミーデータは使用していません)。</p>
      </div>

      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #F5EEF0', paddingBottom: '2px' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700,
              color: tab === key ? '#D98292' : '#9F7E6C', background: tab === key ? '#FDEEF1' : 'transparent',
              border: 'none', borderRadius: '10px 10px 0 0', padding: '8px 14px', cursor: 'pointer',
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'chat' && <ChatListTab />}
      {tab === 'history' && <DeliveryHistoryTab />}
      {tab === 'templates' && <TemplateManagerTab />}
    </div>
  )
}

export function LoadingRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '20px', color: '#C8A8B0', fontSize: '12px' }}>
      <Loader2 size={14} className="animate-spin" /> 読み込み中...
    </div>
  )
}

export function EmptyRow({ message }: { message: string }) {
  return (
    <div style={{ padding: '30px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>{message}</div>
  )
}

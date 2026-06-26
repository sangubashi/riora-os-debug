'use client'
/**
 * ChurnRiskScreen.tsx — 失客リスク管理(画面②・MD-2・owner専用)
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面②
 *
 * 表示は危険顧客一覧/最終来店日/来店間隔/失客リスクスコア/担当スタッフ/
 * 「担当スタッフへ指示」アクションのみ(ユーザー指示・2026-06-23)。
 * 管理者は閲覧と指示のみ。LINE送信・予約操作はこの画面からは一切行わない
 * (「担当スタッフへ指示」はbrain_ops_logsへの記録のみ・現場操作はスタッフアプリの責務)。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Calendar, Clock, User, Loader2, Send, CheckCircle2 } from 'lucide-react'
import { useChurnRiskStore, type ChurnRiskCustomer } from '@/store/useChurnRiskStore'
import { DEMO_STORE_ID } from '@/lib/constants'

function riskColor(score: number): string {
  if (score >= 0.75) return '#D14F4F'
  if (score >= 0.5) return '#E08A3C'
  return '#D9A23C'
}

function InstructPanel({ customer }: { customer: ChurnRiskCustomer }) {
  const { instructStaff, instructingCustomerId } = useChurnRiskStore()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)

  if (!customer.assignedStaffId) {
    return <p style={{ fontSize: '11px', color: '#C8A8B0' }}>担当スタッフ未割当のため指示できません</p>
  }

  if (sent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3C9D5C', fontSize: '12px' }}>
        <CheckCircle2 size={14} />
        {customer.assignedStaffName}さんへ指示済み
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontSize: '12px', fontWeight: 700, color: '#fff', background: '#D98292',
          border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
        }}
      >
        担当スタッフへ指示
      </button>
    )
  }

  const isSending = instructingCustomerId === customer.customerId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={`${customer.assignedStaffName}さんへの指示内容(例: 次回来店時にフォローしてください)`}
        rows={2}
        style={{ fontSize: '12px', padding: '8px', borderRadius: '8px', border: '1px solid #F0E0E4', resize: 'none' }}
      />
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          disabled={note.trim().length === 0 || isSending}
          onClick={async () => {
            const ok = await instructStaff({
              storeId: DEMO_STORE_ID,
              customerId: customer.customerId,
              staffId: customer.assignedStaffId!,
              note: note.trim(),
            })
            if (ok) setSent(true)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700,
            color: '#fff', background: note.trim().length === 0 ? '#E8C0C8' : '#D98292',
            border: 'none', borderRadius: '8px', padding: '6px 12px',
            cursor: note.trim().length === 0 || isSending ? 'default' : 'pointer',
          }}
        >
          {isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          送信
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ fontSize: '12px', color: '#C8A8B0', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}

function ChurnRiskCard({ customer, rank }: { customer: ChurnRiskCustomer; rank: number }) {
  const color = riskColor(customer.churnRiskScore)
  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#C8A8B0' }}>#{rank}</span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{customer.customerName} 様</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color, fontWeight: 700, fontSize: '13px' }}>
          <AlertTriangle size={13} />
          {Math.round(customer.churnRiskScore * 100)}%
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '11px', color: '#9F7E6C' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Calendar size={12} /> 最終来店 {customer.lastVisitDate}({customer.daysSinceLastVisit}日前)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Clock size={12} /> 通常来店間隔 {customer.avgIntervalDays}日
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <User size={12} /> 担当 {customer.assignedStaffName ?? '未割当'}
        </span>
      </div>

      <InstructPanel customer={customer} />
    </div>
  )
}

export default function ChurnRiskScreen() {
  const { dangerCustomers, isLoading, error, fetchChurnRisk } = useChurnRiskStore()

  useEffect(() => {
    fetchChurnRisk(DEMO_STORE_ID)
  }, [fetchChurnRisk])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          画面② MD-2
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>失客リスク管理(離脱予兆センター)</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          通常の来店間隔の1.5倍を超えて来店が無い顧客を表示します。閲覧と担当スタッフへの指示のみ行えます(LINE送信・予約操作はできません)。
        </p>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>
          危険顧客一覧の取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && !error && dangerCustomers.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          現在、危険顧客はいません
        </div>
      )}

      {!isLoading && dangerCustomers.map((c, i) => (
        <ChurnRiskCard key={c.customerId} customer={c} rank={i + 1} />
      ))}
    </div>
  )
}

'use client'
/**
 * CustomerMergeScreen.tsx — 顧客統合(Duplicate Merge Queue Phase1)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §1・§2
 *
 * brain_customers.name の重複候補グループを一覧表示する(DBに永続化しないステートレス
 * 検出。CSV Importのduplicate_customer_name警告と同じ考え方)。区分A(安全に自動統合
 * 可能)・区分B(要確認)のバッジ、グループ内件数、表記ゆれフラグを表示する
 * (§2.2の追加提案項目)。
 */
import { useEffect, useState } from 'react'
import { Loader2, GitMerge, AlertCircle } from 'lucide-react'
import { useCustomerMergeStore } from '@/store/useCustomerMergeStore'
import { DEMO_STORE_ID } from '@/lib/constants'
import MergeGroupDetailModal from './MergeGroupDetailModal'
import type { MergeGroupCategory } from '@/types/customerMerge'

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

function categoryBadge(category: MergeGroupCategory) {
  const config = {
    A: { label: '安全に統合可能', bg: '#E6F4EA', color: '#2E7D46' },
    B: { label: '要確認', bg: '#FDF0DA', color: '#B87B1E' },
    C: { label: '統合禁止', bg: '#FBE4E4', color: '#C43D3D' },
  }[category]
  return (
    <span style={{ fontSize: '10px', fontWeight: 700, color: config.color, background: config.bg, borderRadius: '999px', padding: '3px 8px' }}>
      {config.label}
    </span>
  )
}

export default function CustomerMergeScreen() {
  const { groups, isLoading, error, fetchGroups, fetchGroupDetail, clearDetail } = useCustomerMergeStore()
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    fetchGroups(DEMO_STORE_ID)
  }, [fetchGroups])

  function openDetail(groupKey: string) {
    fetchGroupDetail(DEMO_STORE_ID, groupKey)
    setDetailOpen(true)
  }

  function closeDetail() {
    clearDetail()
    setDetailOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '900px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          顧客統合(Duplicate Merge Queue)
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GitMerge size={18} /> 重複顧客の統合候補
        </h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          同一氏名の顧客レコードを検出し、統合候補として表示します(自動では統合しません)。
          統合は取り消しが難しい操作のため、区分に関わらず詳細画面での確認を必須とします。
        </p>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>候補一覧の取得に失敗しました: {error}</div>
      )}

      {!isLoading && !error && groups.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          現在、統合候補の重複顧客はいません
        </div>
      )}

      {!isLoading && groups.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {groups.map((g) => (
            <button
              key={g.groupKey}
              onClick={() => openDetail(g.groupKey)}
              style={{
                textAlign: 'left', background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px',
                padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{g.displayName}</span>
                  <span style={{ fontSize: '11px', color: '#9F7E6C' }}>{g.memberCount}件</span>
                  {categoryBadge(g.category)}
                  {g.hasNotationVariance && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#B87B1E' }}>
                      <AlertCircle size={11} /> 表記ゆれあり
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '11px', color: '#9F7E6C' }}>
                <span>合計visit数 {g.totalVisitCount}件</span>
                <span>合計売上 {formatYen(g.totalSales)}</span>
                <span>最終来店 {g.lastVisitDate ?? '—'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detailOpen && <MergeGroupDetailModal onClose={closeDetail} />}
    </div>
  )
}

'use client'
/**
 * CustomerAssetsScreen.tsx — 顧客管理(画面③・MD-3・owner専用)
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面③
 *
 * 表示は顧客一覧/来店回数/最終来店日/LTV/累計売上/指名状況/来店間隔のみ
 * (ユーザー指示・2026-06-23)。管理者は閲覧のみ。顧客編集・削除のUIは置かない。
 *
 * AI提案本物化タスクで「AI提案」列(行クリックで提案パネルを開閉)を追加した。
 * 顧客情報の編集・削除には該当しない別機能(提案生成・記録)のため、上記方針とは
 * 矛盾しない(顧客一覧自体は無変更・追加のみ)。
 */
import { Fragment, useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useCustomerAssetsStore } from '@/store/useCustomerAssetsStore'
import { DEMO_STORE_ID } from '@/lib/constants'
import CustomerProposalPanel from './CustomerProposalPanel'

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function formatDays(days: number | null): string {
  return days === null ? '—' : `${days}日`
}

const TH_STYLE: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', color: '#9F7E6C', fontWeight: 700,
  padding: '8px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid #F5EEF0',
}
const TD_STYLE: React.CSSProperties = {
  fontSize: '12px', color: '#5C4033', padding: '8px 10px', whiteSpace: 'nowrap',
  borderBottom: '1px solid #FAF3F4',
}

export default function CustomerAssetsScreen() {
  const { customerAssets, isLoading, error, fetchCustomerAssets } = useCustomerAssetsStore()
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)

  useEffect(() => {
    fetchCustomerAssets(DEMO_STORE_ID)
  }, [fetchCustomerAssets])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '720px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          画面③ MD-3
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>顧客管理</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          顧客資産(LTV順)の一覧です。閲覧専用です(顧客の編集・削除はできません)。
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
          顧客一覧の取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && !error && customerAssets.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          顧客がいません
        </div>
      )}

      {!isLoading && customerAssets.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH_STYLE}>顧客名</th>
                <th style={TH_STYLE}>来店回数</th>
                <th style={TH_STYLE}>最終来店日</th>
                <th style={TH_STYLE}>LTV</th>
                <th style={TH_STYLE}>累計売上</th>
                <th style={TH_STYLE}>指名状況</th>
                <th style={TH_STYLE}>来店間隔</th>
                <th style={TH_STYLE}>AI提案</th>
              </tr>
            </thead>
            <tbody>
              {customerAssets.map((c) => (
                <Fragment key={c.customerId}>
                  <tr>
                    <td style={{ ...TD_STYLE, fontWeight: 700 }}>{c.customerName} 様</td>
                    <td style={TD_STYLE}>{c.visitCount}回</td>
                    <td style={TD_STYLE}>{c.lastVisitDate ?? '—'}</td>
                    <td style={{ ...TD_STYLE, fontWeight: 700 }}>{formatYen(c.ltv)}</td>
                    <td style={TD_STYLE}>{formatYen(c.totalSales)}</td>
                    <td style={TD_STYLE}>{formatPercent(c.nominationRate)}</td>
                    <td style={TD_STYLE}>{formatDays(c.avgIntervalDays)}</td>
                    <td style={TD_STYLE}>
                      <button
                        onClick={() => setExpandedCustomerId(expandedCustomerId === c.customerId ? null : c.customerId)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700,
                          color: '#D98292', background: '#FFF0F2', border: '1px solid #F5E6E8', borderRadius: '8px',
                          padding: '4px 8px', cursor: 'pointer',
                        }}
                      >
                        <Sparkles size={11} />
                        {expandedCustomerId === c.customerId ? '閉じる' : '提案を見る'}
                      </button>
                    </td>
                  </tr>
                  {expandedCustomerId === c.customerId && (
                    <tr>
                      <td colSpan={8} style={{ padding: '0 10px 12px', borderBottom: '1px solid #FAF3F4' }}>
                        <CustomerProposalPanel storeId={DEMO_STORE_ID} customerId={c.customerId} customerName={c.customerName} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

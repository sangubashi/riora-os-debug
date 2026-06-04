'use client'
/**
 * CustomerScoreCard.tsx
 * 顧客スコア（0〜100）とフェーズを表示するカード。
 * 既存UIデザイントークンを完全踏襲。
 */
import { useMemo } from 'react'
import { calcCustomerScore } from '@/lib/phase5/customerRiskEngine'
import { CUSTOMER_PHASE_LABEL, CUSTOMER_PHASE_COLOR } from '@/types'
import type { Customer } from '@/types'

interface Props {
  customer: Customer
}

export default function CustomerScoreCard({ customer }: Props) {
  const result = useMemo(() => calcCustomerScore({
    visits:           customer.visits,
    totalSales:       customer.total_sales,
    avgPrice:         customer.avg_price,
    lineResponseRate: customer.line_response_rate,
    vipRank:          customer.vip_rank,
    churnRisk:        customer.churn_risk,
  }), [customer])

  const phaseColor = CUSTOMER_PHASE_COLOR[result.phase]
  const phaseLabel = CUSTOMER_PHASE_LABEL[result.phase]

  const breakdownItems = [
    result.breakdown.visits,
    result.breakdown.sales,
    result.breakdown.lineResponse,
    result.breakdown.retailSales,
    result.breakdown.referral,
    result.breakdown.retention,
  ]

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #F5EEF0',
      borderRadius: '18px',
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    }}>
      {/* ヘッダー行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em' }}>
          📊 顧客スコア
        </p>
        {/* フェーズバッジ */}
        <span style={{
          background: phaseColor + '22',
          color: phaseColor,
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 10px',
          borderRadius: '999px',
          border: `1px solid ${phaseColor}44`,
        }}>
          {phaseLabel}
        </span>
      </div>

      {/* スコア大表示 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
        <span style={{
          fontSize: '42px',
          fontWeight: 700,
          color: phaseColor,
          lineHeight: 1,
          fontFamily: 'Inter, sans-serif',
        }}>
          {result.total}
        </span>
        <span style={{ fontSize: '14px', color: '#C8A8B0', paddingBottom: '6px' }}>
          / 100
        </span>
      </div>

      {/* スコアバー */}
      <div style={{ background: '#F5EEF0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
        <div style={{
          background: `linear-gradient(90deg, ${phaseColor}88, ${phaseColor})`,
          width: `${result.total}%`,
          height: '100%',
          borderRadius: '4px',
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* 内訳 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {breakdownItems.map(item => (
          <div key={item.label} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}>
            <span style={{ fontSize: '11px', color: '#9F7E6C', minWidth: '72px' }}>
              {item.label}
            </span>
            {/* 内訳バー */}
            <div style={{
              flex: 1,
              background: '#F5EEF0',
              borderRadius: '3px',
              height: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                background: phaseColor + 'AA',
                width: `${(item.score / item.max) * 100}%`,
                height: '100%',
                borderRadius: '3px',
              }} />
            </div>
            <span style={{
              fontSize: '11px',
              color: '#5C4033',
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              minWidth: '40px',
              textAlign: 'right',
            }}>
              {item.score}/{item.max}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

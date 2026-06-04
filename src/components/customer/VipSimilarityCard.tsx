'use client'
/**
 * VipSimilarityCard.tsx
 * VIP顧客との類似度を表示するカード。
 * CustomerBottomSheet の顧客詳細に差し込む。
 * 既存UIデザイントークンを完全踏襲。
 */
import { useMemo } from 'react'
import { calcSimilarityToVip, DEMO_ANALYTICS_CUSTOMERS } from '@/lib/analytics/customerAnalytics'
import type { Customer } from '@/types'

interface Props {
  customer: Customer
}

const GAP_COLOR = {
  near:  '#52B788',   // 緑: 近い
  close: '#FFD166',   // 黄: まあまあ
  far:   '#EF476F',   // 赤: 遠い
}

const GAP_LABEL = {
  near:  '◎',
  close: '△',
  far:   '✕',
}

export default function VipSimilarityCard({ customer }: Props) {
  const targetRow = useMemo(() => ({
    id:               customer.id,
    visits:           customer.visits,
    totalSales:       customer.total_sales,
    avgPrice:         customer.avg_price,
    lineResponseRate: customer.line_response_rate,
    vipRank:          customer.vip_rank,
    churnRisk:        customer.churn_risk,
    daysSinceLastVisit:   0,
    recommendedCycleDays: customer.recommended_cycle_days ?? 30,
    hasRecentPurchase:    !!customer.last_product_purchase,
  }), [customer])

  const result = useMemo(
    () => calcSimilarityToVip(targetRow, DEMO_ANALYTICS_CUSTOMERS),
    [targetRow]
  )

  // VIP本人は表示しない
  if (result.axes.length === 0) return null

  const scoreColor =
    result.score >= 80 ? '#52B788' :
    result.score >= 50 ? '#FFD166' : '#EF476F'

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

      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em' }}>
          👑 VIP類似度
        </p>
        <span style={{
          fontSize: '22px', fontWeight: 700,
          color: scoreColor, fontFamily: 'Inter, sans-serif',
        }}>
          {result.score}<span style={{ fontSize: '12px', fontWeight: 400, color: '#C8A8B0' }}>%</span>
        </span>
      </div>

      {/* スコアバー */}
      <div style={{ background: '#F5EEF0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
        <div style={{
          background: `linear-gradient(90deg, ${scoreColor}88, ${scoreColor})`,
          width: `${result.score}%`,
          height: '100%', borderRadius: '4px',
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* 各軸 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {result.axes.map(axis => (
          <div key={axis.label} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{
              fontSize: '10px', minWidth: '72px', color: '#9F7E6C',
            }}>
              {axis.label}
            </span>
            {/* 顧客バー */}
            <div style={{ flex: 1, position: 'relative', height: '6px' }}>
              {/* VIP基準ライン */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${axis.vipAvg * 100}%`,
                width: '2px', background: '#F56E8B88', borderRadius: '1px',
              }} />
              {/* 顧客バー */}
              <div style={{
                background: '#F5EEF0', borderRadius: '3px', height: '100%', overflow: 'hidden',
              }}>
                <div style={{
                  background: GAP_COLOR[axis.gap],
                  width: `${axis.customer * 100}%`,
                  height: '100%', borderRadius: '3px',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
            {/* 判定マーク */}
            <span style={{
              fontSize: '11px', color: GAP_COLOR[axis.gap],
              minWidth: '14px', textAlign: 'center',
            }}>
              {GAP_LABEL[axis.gap]}
            </span>
          </div>
        ))}
        {/* 凡例 */}
        <p style={{ fontSize: '9px', color: '#D8C0C8', marginTop: '2px' }}>
          ｜ ピンク縦線 = VIP平均
        </p>
      </div>

      {/* AIコメント */}
      <div style={{
        background: '#FFF8F7', borderRadius: '12px',
        padding: '8px 12px', border: '1px solid #F5EEF0',
      }}>
        <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>
          {result.summary}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
          {result.axes.map(a => (
            <span key={a.label} style={{
              fontSize: '10px',
              color: GAP_COLOR[a.gap],
              background: GAP_COLOR[a.gap] + '18',
              border: `1px solid ${GAP_COLOR[a.gap]}44`,
              borderRadius: '999px', padding: '1px 7px',
            }}>
              {a.comment}
            </span>
          ))}
        </div>
      </div>

    </div>
  )
}

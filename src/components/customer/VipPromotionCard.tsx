'use client'
/**
 * VipPromotionCard.tsx
 * VIP昇格シミュレーター。
 * VIPになるために何が不足しているかを可視化する。
 * CustomerBottomSheet に差し込む。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  calcSimilarityToVip,
  calcVipPromotion,
  DEMO_ANALYTICS_CUSTOMERS,
} from '@/lib/analytics/customerAnalytics'
import type { Customer } from '@/types'

interface Props {
  customer: Customer
}

export default function VipPromotionCard({ customer }: Props) {
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

  const simResult  = useMemo(
    () => calcSimilarityToVip(targetRow, DEMO_ANALYTICS_CUSTOMERS),
    [targetRow]
  )
  const result = useMemo(
    () => calcVipPromotion(targetRow, DEMO_ANALYTICS_CUSTOMERS, simResult.score),
    [targetRow, simResult.score]
  )

  // VIP本人 or 不足なしは表示しない
  if (result.isAlreadyVip) return null
  if (result.gaps.length === 0) return null

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
          🎯 VIP到達予測
        </p>
        <span style={{
          fontSize: '10px', background: '#FFF0F4', color: '#F56E8B',
          padding: '2px 8px', borderRadius: '999px', border: '1px solid #FCCDD8',
          fontFamily: 'Inter, sans-serif',
        }}>
          類似度 {result.similarityScore}%
        </span>
      </div>

      {/* 最優先ゴール（大きく表示） */}
      {result.nearestGoal && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            background: 'linear-gradient(135deg, #FFF8F7, #FFF0F4)',
            border: '1px solid #FCCDD8',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '24px' }}>🏆</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '2px' }}>
              最短ルート
            </p>
            <p style={{ fontSize: '16px', fontWeight: 700, color: '#F56E8B', fontFamily: 'Inter, sans-serif' }}>
              {result.nearestGoal.actionText}
            </p>
          </div>
        </motion.div>
      )}

      {/* 不足項目一覧 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {result.gaps.map((gap, i) => {
          const progressPct = Math.min(100, Math.round((gap.current / gap.vipAvg) * 100))
          return (
            <motion.div key={gap.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              style={{
                display: 'flex', flexDirection: 'column', gap: '4px',
                padding: '8px 10px',
                background: '#FFF8F7',
                borderRadius: '12px',
                border: '1px solid #F5EEF0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: '#9F7E6C', fontWeight: 600 }}>
                  {gap.label}
                </span>
                <span style={{ fontSize: '10px', color: '#F56E8B', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
                  {gap.actionText}
                </span>
              </div>
              {/* 進捗バー */}
              <div style={{ background: '#F5EEF0', borderRadius: '4px', height: '5px', overflow: 'hidden', position: 'relative' }}>
                {/* VIP平均ライン */}
                <div style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0,
                  width: '2px', background: '#F56E8B66',
                }} />
                <div style={{
                  background: 'linear-gradient(90deg, #F56E8B88, #F56E8B)',
                  width: `${progressPct}%`,
                  height: '100%', borderRadius: '4px',
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '9px', color: '#C8A8B0', fontFamily: 'Inter, sans-serif' }}>
                  現在: {gap.unit === '円' ? `¥${gap.current.toLocaleString()}` : `${gap.current}${gap.unit}`}
                </span>
                <span style={{ fontSize: '9px', color: '#C8A8B0', fontFamily: 'Inter, sans-serif' }}>
                  VIP平均: {gap.unit === '円' ? `¥${gap.vipAvg.toLocaleString()}` : `${gap.vipAvg}${gap.unit}`}
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* AIコメント */}
      <div style={{
        background: '#F8F5F0', borderRadius: '12px',
        padding: '8px 12px', border: '1px solid #EDE5DC',
      }}>
        <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>
          ✨ {result.summary}
        </p>
      </div>

    </div>
  )
}

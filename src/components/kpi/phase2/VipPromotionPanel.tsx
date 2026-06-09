'use client'
/**
 * VipPromotionPanel.tsx — VIP化ダッシュボード
 * 既存の calcSimilarityToVip / calcVipPromotion を再利用。
 * 新規DB追加なし。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useCustomerStore, type CustomerRow } from '@/store/useCustomerStore'
import { calcCustomerPhase } from '@/lib/phase5/customerRiskEngine'
import { calcSimilarityToVip, calcVipPromotion } from '@/lib/analytics/customerAnalytics'
import type { AnalyticsCustomerRow } from '@/lib/analytics/customerAnalytics'

// ─── CustomerRow → AnalyticsCustomerRow 変換 ─────────────────────────────────

function toAnalyticsRow(c: CustomerRow): AnalyticsCustomerRow {
  return {
    id:               c.id,
    visits:           c.visitCount,
    totalSales:       c.totalSpent,
    avgPrice:         c.visitCount > 0 ? Math.round(c.totalSpent / c.visitCount) : 0,
    lineResponseRate: c.lineResponseRate,
    vipRank:          c.isVip ? 3 : 0,
    churnRisk:        c.churnRisk,
    daysSinceLastVisit:   c.lastVisit,
    recommendedCycleDays: 30,
    hasRecentPurchase:    false,
  }
}

// ─── フォーマット ─────────────────────────────────────────────────────────────

function formatYen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

// ─── サマリーカード ───────────────────────────────────────────────────────────

function SummaryChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      flex: 1, background: '#fff', border: `1px solid ${color}33`,
      borderRadius: '14px', padding: '10px 12px', textAlign: 'center',
    }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: '20px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif' }}>{count}</p>
      <p style={{ fontSize: '9px', color: '#C8A8B0' }}>名</p>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function VipPromotionPanel() {
  const customers = useCustomerStore(s => s.customers)

  const { candidates, vipCount, high70Count, allRows } = useMemo(() => {
    const allRows = customers.map(toAnalyticsRow)

    const enriched = customers.map(c => {
      const row  = toAnalyticsRow(c)
      const sim  = calcSimilarityToVip(row, allRows)
      const prom = calcVipPromotion(row, allRows, sim.score)
      const phase = calcCustomerPhase({
        visits: c.visitCount, totalSales: c.totalSpent,
        vipRank: c.isVip ? 3 : 0, churnRisk: c.churnRisk,
        daysSinceLastVisit: c.lastVisit, recommendedCycleDays: 30,
      })
      return { c, row, sim, prom, phase }
    })

    const nonVip = enriched.filter(e => e.phase !== 'vip')
    const sorted = [...nonVip].sort((a, b) => b.sim.score - a.sim.score)

    return {
      candidates:  sorted.slice(0, 8),
      vipCount:    enriched.filter(e => e.phase === 'vip').length,
      high70Count: nonVip.filter(e => e.sim.score >= 70).length,
      allRows,
    }
  }, [customers])

  if (customers.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <p style={{ fontSize: '12px', color: '#C8A8B0' }}>顧客データがありません</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 16px 24px' }}>

      {/* サマリー */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <SummaryChip label="現在のVIP"      count={vipCount}    color="#FFD166" />
        <SummaryChip label="VIP候補(70%以上)" count={high70Count} color="#F56E8B" />
        <SummaryChip label="候補合計"        count={candidates.length} color="#74C69D" />
      </div>

      {/* 候補一覧 */}
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '18px', overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, #FFFBF0, #FFF8F7)',
          borderBottom: '1px solid #F5EEF0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '14px' }}>👑</span>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>VIP候補ランキング</p>
          </div>
          <span style={{
            fontSize: '9px', padding: '2px 8px', borderRadius: '999px',
            background: '#FFD16622', color: '#D4A017', border: '1px solid #FFD16644', fontWeight: 600,
          }}>
            類似度順
          </span>
        </div>

        {candidates.map(({ c, sim, prom }, i) => {
          const scoreColor = sim.score >= 80 ? '#52B788' : sim.score >= 60 ? '#FFD166' : '#C8A8B0'
          const nearest    = prom.nearestGoal

          return (
            <motion.div key={c.id}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              style={{
                padding: '12px 16px',
                borderBottom: i < candidates.length - 1 ? '1px solid #F8F0F2' : 'none',
                background: i % 2 === 0 ? '#fff' : '#FFFBF8',
              }}
            >
              {/* 1行目: 順位・名前・類似度 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, minWidth: '18px',
                  textAlign: 'center', fontFamily: 'Inter, sans-serif',
                  color: i === 0 ? '#D4A017' : i === 1 ? '#9E8090' : '#C8A8B0',
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#5C4033', flex: 1 }}>
                  {c.name}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '36px', height: '4px', background: '#F5EEF0', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${sim.score}%`, height: '100%', background: scoreColor, borderRadius: '2px' }} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: scoreColor, fontFamily: 'Inter, sans-serif', minWidth: '30px' }}>
                    {sim.score}%
                  </span>
                </div>
              </div>

              {/* 2行目: 不足情報 */}
              {nearest && (
                <div style={{ paddingLeft: '26px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, padding: '2px 8px',
                    borderRadius: '999px',
                    background: '#F56E8B18', color: '#F56E8B',
                    border: '1px solid #F56E8B44',
                  }}>
                    {nearest.actionText}
                  </span>
                  <span style={{ fontSize: '9px', color: '#C8A8B0' }}>
                    累計 {formatYen(c.totalSpent)} / {c.visitCount}回
                  </span>
                </div>
              )}

              {/* 3行目: 不足項目タグ */}
              {prom.gaps.length > 0 && (
                <div style={{ paddingLeft: '26px', display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {prom.gaps.slice(0, 3).map(g => (
                    <span key={g.label} style={{
                      fontSize: '9px', padding: '1px 6px', borderRadius: '4px',
                      background: '#F8F5F0', color: '#9F7E6C', border: '1px solid #EDE5DC',
                    }}>
                      {g.label}不足
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

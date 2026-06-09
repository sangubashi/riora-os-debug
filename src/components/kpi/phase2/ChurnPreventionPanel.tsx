'use client'
/**
 * ChurnPreventionPanel.tsx — 失客防止ダッシュボード
 * 既存の useCustomerStore / calcCustomerPhase / ChurnRiskRanking を再利用。
 * 新規DB追加なし。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useCustomerStore } from '@/store/useCustomerStore'
import { calcCustomerPhase } from '@/lib/phase5/customerRiskEngine'
import { CUSTOMER_PHASE_COLOR } from '@/types'

// ─── 推奨アクション ──────────────────────────────────────────────────────────

function getAction(churnRisk: number, lineResponseRate: number, hasNextRebook: boolean) {
  if (churnRisk >= 70) return { label: 'LINE緊急フォロー', color: '#EF476F' }
  if (!hasNextRebook)  return { label: '次回来店を提案',   color: '#F56E8B' }
  if (lineResponseRate < 40) return { label: '直接フォロー', color: '#FFD166' }
  return                     { label: 'LINEフォロー',       color: '#74C69D' }
}

function getRiskReasons(lastVisit: number, lineResponseRate: number, hasNextRebook: boolean, visitCount: number): string[] {
  const r: string[] = []
  if (lastVisit >= 60)          r.push(`${lastVisit}日来店なし`)
  else if (lastVisit >= 30)     r.push(`${lastVisit}日経過`)
  if (!hasNextRebook)           r.push('次回予約なし')
  if (lineResponseRate < 40)    r.push(`LINE返信率${lineResponseRate}%`)
  if (visitCount <= 2)          r.push('来店少ない')
  return r.slice(0, 3)
}

// ─── サマリーカード ───────────────────────────────────────────────────────────

function SummaryChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      flex: 1, background: '#fff', border: `1px solid ${color}33`,
      borderRadius: '14px', padding: '10px 12px', textAlign: 'center',
    }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: '20px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif' }}>
        {count}
      </p>
      <p style={{ fontSize: '9px', color: '#C8A8B0' }}>名</p>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function ChurnPreventionPanel() {
  const customers = useCustomerStore(s => s.customers)

  const { overdue, noRebook, highRisk, riskList } = useMemo(() => {
    const enriched = customers.map(c => {
      const phase = calcCustomerPhase({
        visits:               c.visitCount,
        totalSales:           c.totalSpent,
        vipRank:              c.isVip ? 3 : 0,
        churnRisk:            c.churnRisk,
        daysSinceLastVisit:   c.lastVisit,
        recommendedCycleDays: 30,
      })
      return { ...c, phase }
    })

    return {
      overdue:  enriched.filter(c => c.lastVisit >= 30).length,
      noRebook: enriched.filter(c => !c.hasNextRebook).length,
      highRisk: enriched.filter(c => c.churnRisk >= 60).length,
      riskList: [...enriched]
        .sort((a, b) => b.churnRisk - a.churnRisk)
        .slice(0, 10),
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
        <SummaryChip label="来店超過"    count={overdue}  color="#FFD166" />
        <SummaryChip label="次回予約なし" count={noRebook} color="#F56E8B" />
        <SummaryChip label="高リスク"    count={highRisk} color="#EF476F" />
      </div>

      {/* 顧客リスト */}
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '18px', overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, #FFF0F0, #FFF8F7)',
          borderBottom: '1px solid #F5EEF0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '14px' }}>🚨</span>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>失客予備軍</p>
          </div>
          <span style={{
            fontSize: '9px', padding: '2px 8px', borderRadius: '999px',
            background: '#EF476F22', color: '#EF476F', border: '1px solid #EF476F44', fontWeight: 600,
          }}>
            TOP {riskList.length}
          </span>
        </div>

        {riskList.map((c, i) => {
          const riskColor = CUSTOMER_PHASE_COLOR['risk']
          const action    = getAction(c.churnRisk, c.lineResponseRate, c.hasNextRebook)
          const reasons   = getRiskReasons(c.lastVisit, c.lineResponseRate, c.hasNextRebook, c.visitCount)

          return (
            <motion.div key={c.id}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              style={{
                padding: '10px 16px',
                borderBottom: i < riskList.length - 1 ? '1px solid #F8F0F2' : 'none',
                background: i % 2 === 0 ? '#fff' : '#FFFBF8',
              }}
            >
              {/* 1行目: 順位・名前・危険度 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, minWidth: '18px',
                  textAlign: 'center', fontFamily: 'Inter, sans-serif',
                  color: i === 0 ? '#EF476F' : i === 1 ? '#F56E8B' : '#C8A8B0',
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#5C4033', flex: 1 }}>
                  {c.name}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '36px', height: '4px', background: '#F5EEF0', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${c.churnRisk}%`, height: '100%', background: riskColor, borderRadius: '2px' }} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: riskColor, fontFamily: 'Inter, sans-serif', minWidth: '30px' }}>
                    {c.churnRisk}%
                  </span>
                </div>
              </div>

              {/* 2行目: 理由タグ */}
              {reasons.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '5px', paddingLeft: '26px' }}>
                  {reasons.map(r => (
                    <span key={r} style={{
                      fontSize: '9px', padding: '2px 7px', borderRadius: '4px',
                      background: '#FFF0F0', color: '#EF476F', border: '1px solid #FCCDD8',
                    }}>{r}</span>
                  ))}
                </div>
              )}

              {/* 3行目: 推奨アクション */}
              <div style={{ paddingLeft: '26px' }}>
                <span style={{
                  fontSize: '9px', fontWeight: 700, padding: '2px 8px',
                  borderRadius: '999px',
                  background: action.color + '18',
                  color: action.color,
                  border: `1px solid ${action.color}44`,
                }}>
                  → {action.label}
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

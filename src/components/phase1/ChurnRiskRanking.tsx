'use client'
/**
 * ChurnRiskRanking.tsx
 * 離脱危険ランキング TOP10 + AI危険理由 + 推奨アクション。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useCustomerStore } from '@/store/useCustomerStore'
import type { CustomerRow } from '@/store/useCustomerStore'

const RISK_COLOR = (risk: number): string =>
  risk >= 70 ? '#EF476F' :
  risk >= 50 ? '#F56E8B' :
  risk >= 30 ? '#FFD166' : '#74C69D'

// ─── 危険理由を生成（最大3件） ─────────────────────────────────────────────────

function getRiskReasons(c: CustomerRow): string[] {
  const reasons: string[] = []
  if (c.lastVisit >= 60)        reasons.push(`前回来店 ${c.lastVisit}日前`)
  else if (c.lastVisit >= 30)   reasons.push(`来店 ${c.lastVisit}日経過`)
  if (c.lineResponseRate < 40)  reasons.push(`LINE返信率 ${c.lineResponseRate}%`)
  if (!c.hasNextRebook)         reasons.push('次回予約なし')
  if (c.visitCount <= 2)        reasons.push('来店回数が少ない')
  return reasons.slice(0, 3)
}

// ─── 推奨アクションを1件生成 ──────────────────────────────────────────────────

function getAction(c: CustomerRow): { label: string; color: string } {
  if (c.lineResponseRate >= 40) return { label: 'LINEフォロー',    color: '#4878A8' }
  if (!c.hasNextRebook)         return { label: '次回来店を提案',  color: '#52B788' }
  return                               { label: '店販フォロー',    color: '#F56E8B' }
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function ChurnRiskRanking() {
  const customers = useCustomerStore(s => s.customers)

  const ranking = useMemo(() =>
    [...customers]
      .sort((a, b) => b.churnRisk - a.churnRisk)
      .slice(0, 10),
    [customers]
  )

  if (ranking.length === 0) return null

  return (
    <div style={{
      background: '#fff', border: '1px solid #F5EEF0',
      borderRadius: '18px', overflow: 'hidden', margin: '0 0 12px',
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '12px 16px',
        background: 'linear-gradient(135deg, #FFF0F0, #FFF8F7)',
        borderBottom: '1px solid #F5EEF0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>🚨</span>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>
            離脱危険ランキング
          </p>
        </div>
        <span style={{
          fontSize: '9px', padding: '2px 8px', borderRadius: '999px',
          background: '#EF476F22', color: '#EF476F',
          border: '1px solid #EF476F44', fontWeight: 600,
        }}>
          TOP {ranking.length}
        </span>
      </div>

      {/* リスト */}
      {ranking.map((c, i) => {
        const riskColor = RISK_COLOR(c.churnRisk)
        const reasons   = getRiskReasons(c)
        const action    = getAction(c)

        return (
          <motion.div key={c.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            style={{
              padding: '10px 16px',
              borderBottom: i < ranking.length - 1 ? '1px solid #F8F0F2' : 'none',
              background: i % 2 === 0 ? '#fff' : '#FFFBF8',
            }}
          >
            {/* 1行目: 順位・名前・危険度 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{
                fontSize: '11px', fontWeight: 700, minWidth: '18px',
                textAlign: 'center', fontFamily: 'Inter, sans-serif',
                color: i === 0 ? '#EF476F' : i === 1 ? '#F56E8B' : '#C8A8B0',
              }}>
                {i + 1}
              </span>
              <span style={{
                fontSize: '13px', fontWeight: 600, color: '#5C4033',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.name}
              </span>
              {/* 危険度バー + % */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '36px', height: '4px', background: '#F5EEF0', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${c.churnRisk}%`, height: '100%', background: riskColor, borderRadius: '2px' }} />
                </div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: riskColor, fontFamily: 'Inter, sans-serif', minWidth: '30px', textAlign: 'right' }}>
                  {c.churnRisk}%
                </span>
              </div>
            </div>

            {/* 2行目: 危険理由タグ */}
            {reasons.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px', paddingLeft: '26px' }}>
                {reasons.map(r => (
                  <span key={r} style={{
                    fontSize: '9px', padding: '2px 7px', borderRadius: '4px',
                    background: '#FFF0F0', color: '#EF476F',
                    border: '1px solid #FCCDD8',
                  }}>
                    {r}
                  </span>
                ))}
              </div>
            )}

            {/* 3行目: 推奨アクション + LINE返信率・予約バッジ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '26px' }}>
              <span style={{
                fontSize: '9px', fontWeight: 700, padding: '2px 8px',
                borderRadius: '999px',
                background: action.color + '18',
                color: action.color,
                border: `1px solid ${action.color}44`,
                whiteSpace: 'nowrap',
              }}>
                → {action.label}
              </span>
              <span style={{ fontSize: '9px', color: '#C8A8B0', marginLeft: 'auto' }}>
                LINE {c.lineResponseRate}%
              </span>
              <span style={{
                fontSize: '8px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px',
                background: c.hasNextRebook ? '#E8F5F0' : '#FFF0F0',
                color: c.hasNextRebook ? '#52B788' : '#EF476F',
              }}>
                {c.hasNextRebook ? '予約済' : '未予約'}
              </span>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

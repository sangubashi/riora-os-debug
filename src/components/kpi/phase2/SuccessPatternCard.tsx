'use client'
/**
 * SuccessPatternCard.tsx
 *
 * SuccessPatternAnalyzer の結果を表示する。
 * SalesImprovementRanking の末尾に差し込む。
 * 既存 UI は変更しない。
 */
import { useMemo }        from 'react'
import { motion }         from 'framer-motion'
import { useKpiStore }    from '@/store/useKpiStore'
import { useCustomerStore } from '@/store/useCustomerStore'
import { DEMO_MODE }      from '@/lib/supabase'
import {
  analyzeSuccessPatterns,
  type SuccessPattern,
} from '@/lib/analytics/SuccessPatternAnalyzer'

// ─── フォーマット ─────────────────────────────────────────────────────────────

function yen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

// ─── スコアバー ───────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? '#EF476F' : score >= 60 ? '#F56E8B' : '#FFD166'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ flex: 1, background: '#F5EEF0', borderRadius: '4px', height: '5px', overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ height: '100%', borderRadius: '4px', background: color }}
        />
      </div>
      <span style={{ fontSize: '10px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif', minWidth: '28px' }}>
        {score}pt
      </span>
    </div>
  )
}

// ─── 個別パターンカード ───────────────────────────────────────────────────────

function PatternCard({ p, i }: { p: SuccessPattern; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.08 }}
      style={{
        background: '#fff', border: '1px solid #F5EEF0',
        borderRadius: '16px', overflow: 'hidden',
      }}
    >
      {/* ヘッダー */}
      <div style={{
        padding: '10px 14px',
        background: 'linear-gradient(135deg, #FFF8F7, #FFFBF8)',
        borderBottom: '1px solid #F5EEF0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>
            {p.topStaff}の成功パターン
          </p>
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#52B788',
            fontFamily: 'Inter, sans-serif',
          }}>
            +{yen(p.expectedImpact)}/月
          </span>
        </div>
        <ScoreBar score={p.score} />
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* TOP vs BOTTOM 比較バー */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { name: p.topStaff,    value: p.topValue,    isTop: true },
            { name: p.bottomStaff, value: p.bottomValue, isTop: false },
          ].map(({ name, value, isTop }) => (
            <div key={name} style={{
              flex: 1, background: isTop ? '#F0FFF8' : '#FFF8F7',
              borderRadius: '10px', padding: '8px 10px',
              border: `1px solid ${isTop ? '#74C69D44' : '#F5EEF0'}`,
            }}>
              <p style={{ fontSize: '10px', color: isTop ? '#52B788' : '#C8A8B0', marginBottom: '2px' }}>
                {name}
              </p>
              <p style={{
                fontSize: '18px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
                color: isTop ? '#52B788' : '#9F7E6C',
              }}>
                {value}%
              </p>
            </div>
          ))}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', minWidth: '44px',
          }}>
            <p style={{ fontSize: '9px', color: '#C8A8B0' }}>差分</p>
            <p style={{ fontSize: '15px', fontWeight: 700, color: '#EF476F', fontFamily: 'Inter, sans-serif' }}>
              +{p.diffValue}%
            </p>
          </div>
        </div>

        {/* 根拠 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600 }}>成功行動の根拠</p>
          {p.evidence.map((ev, j) => (
            <div key={j} style={{ display: 'flex', gap: '5px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '10px', color: '#52B788', flexShrink: 0, marginTop: '1px' }}>✓</span>
              <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>{ev}</p>
            </div>
          ))}
        </div>

        {/* 推奨アクション */}
        <div style={{
          padding: '8px 10px', background: '#F0F8FF',
          borderRadius: '10px', border: '1px solid #B8D4F0',
        }}>
          <p style={{ fontSize: '10px', color: '#4878A8', fontWeight: 600, marginBottom: '3px' }}>
            推奨アクション
          </p>
          <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>{p.action}</p>
        </div>
      </div>
    </motion.div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function SuccessPatternCard() {
  const { current, staffRanking } = useKpiStore()
  const customers = useCustomerStore(s => s.customers)

  const result = useMemo(() =>
    analyzeSuccessPatterns(
      customers,
      staffRanking,
      current.avgSpend || 14000,
      customers.length || 30,
      DEMO_MODE,
    ),
    [customers, staffRanking, current.avgSpend]
  )

  if (result.patterns.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* セクションタイトル */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '14px' }}>🏆</span>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#5C4033' }}>
          成功行動学習
        </p>
        <span style={{
          fontSize: '9px', padding: '2px 7px', borderRadius: '999px',
          background: '#52B78822', color: '#52B788',
          border: '1px solid #52B78844', fontWeight: 600,
        }}>
          {result.patterns.length}パターン検出
        </span>
      </div>

      {/* トップスタッフ一言 */}
      {result.topStaff && (
        <div style={{
          padding: '10px 12px', background: '#F0FFF8',
          borderRadius: '12px', border: '1px solid #74C69D44',
        }}>
          <p style={{ fontSize: '11px', color: '#2D6A4F', lineHeight: 1.6 }}>
            <strong>{result.topStaff.staffName}</strong> が全指標でトップ。
            次回予約率 <strong>{result.topStaff.nextReserveRate}%</strong>、
            VIP率 <strong>{result.topStaff.vipRate}%</strong>。
            この行動を横展開することで月次{' '}
            <strong style={{ color: '#52B788' }}>
              {yen(result.patterns.reduce((s, p) => s + p.expectedImpact, 0))}
            </strong>{' '}
            の改善余地があります。
          </p>
        </div>
      )}

      {/* パターンカード */}
      {result.patterns.slice(0, 3).map((p, i) => (
        <PatternCard key={p.metric} p={p} i={i} />
      ))}
    </div>
  )
}

'use client'
/**
 * ImprovementInsightCard.tsx
 *
 * ImprovementAnalyzer の結果を
 *   🔥 最優先改善 / 📈 強み / 💡 その他改善
 * の3ブロックで表示するカードコンポーネント。
 *
 * StaffImprovementPanel 内の既存 StaffCard の下に差し込む。
 * 既存 UI は一切変更しない。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useKpiStore }      from '@/store/useKpiStore'
import { useCustomerStore } from '@/store/useCustomerStore'
import {
  analyzeImprovements,
  buildAnalysisInput,
  type Weakness,
  type Strength,
  type InsightPriority,
} from '@/lib/analytics/ImprovementAnalyzer'
import { analyzeSuccessPatterns } from '@/lib/analytics/SuccessPatternAnalyzer'
import { DEMO_MODE }              from '@/lib/supabase'

// ─── 優先度バッジ ─────────────────────────────────────────────────────────────

const PRIORITY_META: Record<InsightPriority, { icon: string; label: string; color: string }> = {
  critical: { icon: '🔥', label: '最優先',  color: '#EF476F' },
  high:     { icon: '⚠️', label: '要改善',  color: '#F56E8B' },
  medium:   { icon: '💡', label: '推奨',    color: '#FFD166' },
  low:      { icon: '📌', label: '参考',    color: '#74C69D' },
}

// ─── 最優先改善カード ─────────────────────────────────────────────────────────

function TopIssueCard({ item }: { item: Weakness }) {
  const meta = PRIORITY_META[item.priority]
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      style={{
        background: '#fff', border: `1px solid ${meta.color}44`,
        borderRadius: '16px', overflow: 'hidden',
      }}
    >
      {/* タイトルバー */}
      <div style={{
        padding: '10px 14px',
        background: meta.color + '12',
        borderBottom: `1px solid ${meta.color}22`,
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        <span style={{ fontSize: '14px' }}>{meta.icon}</span>
        <p style={{ fontSize: '11px', fontWeight: 700, color: meta.color }}>
          {meta.label}
        </p>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* 指標名 + 数値 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>{item.label}</p>
            <p style={{ fontSize: '10px', color: meta.color, fontWeight: 600 }}>{item.diff}</p>
          </div>
          <p style={{
            fontSize: '20px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
            color: meta.color,
          }}>
            {item.value}
          </p>
        </div>

        {/* 理由 */}
        <div style={{
          padding: '8px 10px', background: '#FBF3F5', borderRadius: '10px',
          border: '1px solid #F0E8EC',
        }}>
          <p style={{ fontSize: '10px', color: '#9F7E6C', fontWeight: 600, marginBottom: '3px' }}>
            理由
          </p>
          <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>{item.reason}</p>
        </div>

        {/* 推奨アクション */}
        <div style={{
          padding: '8px 10px', background: '#F5FCFF', borderRadius: '10px',
          border: '1px solid #B8E0F0',
        }}>
          <p style={{ fontSize: '10px', color: '#4878A8', fontWeight: 600, marginBottom: '3px' }}>
            推奨アクション
          </p>
          <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>
            {item.recommendation}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ─── 強みカード ───────────────────────────────────────────────────────────────

function StrengthCard({ item }: { item: Strength }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      style={{
        background: '#F0FFF8', border: '1px solid #74C69D44',
        borderRadius: '14px', padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#2D6A4F' }}>{item.label}</p>
          <p style={{ fontSize: '10px', color: '#52B788', fontWeight: 600 }}>{item.diff}</p>
        </div>
        <p style={{
          fontSize: '18px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
          color: '#52B788',
        }}>
          {item.value}
        </p>
      </div>
      <p style={{ fontSize: '11px', color: '#2D6A4F', lineHeight: 1.6, marginBottom: '4px' }}>
        {item.reason}
      </p>
      <p style={{ fontSize: '10px', color: '#52B788', fontStyle: 'italic' }}>
        💡 {item.advice}
      </p>
    </motion.div>
  )
}

// ─── その他改善 小カード ──────────────────────────────────────────────────────

function MiniIssueCard({ item }: { item: Weakness }) {
  const meta = PRIORITY_META[item.priority]
  return (
    <div style={{
      background: '#fff', border: `1px solid ${meta.color}33`,
      borderRadius: '12px', padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <p style={{ fontSize: '11px', fontWeight: 600, color: '#5C4033' }}>
          {meta.icon} {item.label}
        </p>
        <p style={{ fontSize: '11px', fontFamily: 'Inter, sans-serif', color: meta.color, fontWeight: 700 }}>
          {item.value}
        </p>
      </div>
      <p style={{ fontSize: '10px', color: '#C8A8B0' }}>{item.diff}</p>
      <p style={{ fontSize: '10px', color: '#9F7E6C', marginTop: '4px', lineHeight: 1.5 }}>
        → {item.recommendation}
      </p>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function ImprovementInsightCard() {
  const { current } = useKpiStore()
  const customers   = useCustomerStore(s => s.customers)
  const { staffRanking } = useKpiStore()

  const result = useMemo(() => {
    const input = buildAnalysisInput({
      nextReserveRate:  current.nextReserveRate,
      repeatRate:       current.repeatRate,
      lineResponseRate: current.lineResponseRate,
      avgSpend:         current.avgSpend,
      vipRate:          current.vipRate,
      customers,
    })
    return analyzeImprovements(input)
  }, [current, customers])

  const successResult = useMemo(() =>
    analyzeSuccessPatterns(customers, staffRanking, current.avgSpend || 14000, customers.length || 30, DEMO_MODE),
    [customers, staffRanking, current.avgSpend]
  )
  const topPattern = successResult.patterns[0] ?? null

  const otherWeaknesses = result.weaknesses.slice(1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* セクションタイトル */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '4px' }}>
        <span style={{ fontSize: '12px' }}>🧠</span>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#5C4033' }}>
          AI改善分析
        </p>
        <span style={{
          fontSize: '9px', padding: '2px 7px', borderRadius: '999px',
          background: '#F56E8B22', color: '#F56E8B', border: '1px solid #F56E8B44',
        }}>
          {result.weaknesses.length}件の改善点
        </span>
      </div>

      {/* サマリー */}
      <div style={{
        padding: '10px 12px', background: '#FBF3F5',
        borderRadius: '12px', border: '1px solid #F0E8EC',
      }}>
        <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>
          {result.summary}
        </p>
      </div>

      {/* 最優先改善 */}
      {result.topRecommendation && (
        <TopIssueCard item={result.topRecommendation} />
      )}

      {/* 成功スタッフとの差分 */}
      {topPattern && (
        <div style={{
          padding: '10px 12px', background: '#F0FFF8',
          borderRadius: '12px', border: '1px solid #74C69D44',
        }}>
          <p style={{ fontSize: '10px', color: '#52B788', fontWeight: 600, marginBottom: '4px' }}>
            🏆 {topPattern.topStaff} との差分
          </p>
          <p style={{ fontSize: '11px', color: '#2D6A4F', lineHeight: 1.6 }}>
            {topPattern.topStaff} の{topPattern.metric === 'nextReserveRate' ? '次回予約率' :
              topPattern.metric === 'vipRate' ? 'VIP育成率' : topPattern.metric}{' '}
            <strong>{topPattern.topValue}%</strong> に対し{' '}
            {topPattern.bottomStaff} は <strong>{topPattern.bottomValue}%</strong>（差 +{topPattern.diffValue}%）
          </p>
          <p style={{ fontSize: '10px', color: '#74C69D', marginTop: '4px', fontStyle: 'italic' }}>
            → {topPattern.action}
          </p>
        </div>
      )}

      {/* 強み */}
      {result.strengths.length > 0 && (
        <>
          <p style={{ fontSize: '10px', color: '#52B788', fontWeight: 700, marginTop: '4px' }}>
            📈 強み
          </p>
          {result.strengths.map(s => (
            <StrengthCard key={s.metric} item={s} />
          ))}
        </>
      )}

      {/* その他改善点 */}
      {otherWeaknesses.length > 0 && (
        <>
          <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600, marginTop: '4px' }}>
            その他の改善点
          </p>
          {otherWeaknesses.map(w => (
            <MiniIssueCard key={w.metric} item={w} />
          ))}
        </>
      )}

      {/* 問題なし */}
      {result.weaknesses.length === 0 && (
        <div style={{
          background: '#F0FFF8', border: '1px solid #74C69D44',
          borderRadius: '14px', padding: '16px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#2D6A4F', marginBottom: '4px' }}>
            ✅ 全指標が良好です
          </p>
          <p style={{ fontSize: '11px', color: '#52B788' }}>
            この状態を維持しながら VIP化率をさらに高めましょう。
          </p>
        </div>
      )}
    </div>
  )
}

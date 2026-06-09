'use client'
/**
 * SalesImprovementRanking.tsx
 *
 * ① 改善インパクトランキング（売上貢献額順）
 * ② 成功スタッフ比較
 * ③ AI改善TODO（今日やること 3件）
 *
 * StaffImprovementPanel の末尾に差し込む。既存 UI は変更しない。
 */
import { useMemo } from 'react'
import { motion }  from 'framer-motion'
import { useKpiStore }      from '@/store/useKpiStore'
import { useCustomerStore } from '@/store/useCustomerStore'
import { calcImprovementImpact } from '@/lib/analytics/ImprovementImpactCalculator'
import { generateDailyTodos }    from '@/lib/analytics/GenerateDailyTodo'
import { buildAnalysisInput }    from '@/lib/analytics/ImprovementAnalyzer'
import { analyzeSuccessPatterns } from '@/lib/analytics/SuccessPatternAnalyzer'
import { runSuccessCloneEngine }  from '@/lib/analytics/SuccessCloneEngine'
import { useImprovementLogStore } from '@/store/useImprovementLogStore'
import { DEMO_MODE }              from '@/lib/supabase'
import SuccessPatternCard        from './SuccessPatternCard'

// ─── フォーマット ─────────────────────────────────────────────────────────────

function yen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

function pct(n: number): string { return `${n}%` }

// ─── 優先度カラー ─────────────────────────────────────────────────────────────

const P_COLOR: Record<string, string> = {
  critical: '#EF476F', high: '#F56E8B', medium: '#FFD166', low: '#74C69D',
}

// ─── ① 改善インパクトランキング ───────────────────────────────────────────────


// ─── 成功スタッフ模倣ランキング ───────────────────────────────────────────────

function SuccessCloneRanking() {
  const { current } = useKpiStore()
  const customers   = useCustomerStore(s => s.customers)
  const { staffRanking } = useKpiStore()
  const { getStats }     = useImprovementLogStore()

  const result = useMemo(() => {
    const successResult = analyzeSuccessPatterns(
      customers, staffRanking, current.avgSpend || 14000, customers.length || 30, DEMO_MODE,
    )
    return runSuccessCloneEngine({
      staffMetrics:   successResult.staffMetrics,
      actionStats:    getStats(),
      avgSpend:       current.avgSpend || 14000,
      monthlyVisits:  customers.length || 30,
      demoMode:       DEMO_MODE,
    })
  }, [current, customers, staffRanking, getStats])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px' }}>🏆</span>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#5C4033' }}>今月の成功行動</p>
        </div>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#52B788', fontFamily: 'Inter, sans-serif' }}>
          合計 {yen(result.topActions.reduce((s, a) => s + a.estimatedRevenue, 0))}/月
        </span>
      </div>

      {result.topActions.slice(0, 3).map((action, i) => (
        <motion.div key={action.id}
          initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.07 }}
          style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', padding: '12px 14px' }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, minWidth: '20px', color: i === 0 ? '#D4A017' : i === 1 ? '#9E8090' : '#C8A8B0', fontFamily: 'Inter, sans-serif' }}>
              {i + 1}
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', lineHeight: 1.5, marginBottom: '4px' }}>
                {action.action}
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '4px', background: '#F0FFF8', color: '#52B788', border: '1px solid #74C69D44' }}>
                  改善率 +{Math.round(action.uplift * 100)}%
                </span>
                <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '4px', background: '#F0F8FF', color: '#4878A8', border: '1px solid #B8D4F044' }}>
                  信頼度 {Math.round(action.confidence * 100)}%
                </span>
                <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#FFF8F0', color: '#F56E8B', border: '1px solid #F56E8B33' }}>
                  +{yen(action.estimatedRevenue)}/月
                </span>
              </div>
            </div>
          </div>
          {action.evidences.slice(0, 2).map(ev => (
            <p key={ev} style={{ fontSize: '10px', color: '#9F7E6C', lineHeight: 1.5, paddingLeft: '28px' }}>✓ {ev}</p>
          ))}
        </motion.div>
      ))}

      {result.clones.length > 0 && (
        <>
          <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600, marginTop: '4px' }}>スタッフ別 移植提案</p>
          {result.clones.map(clone => (
            <div key={clone.targetStaff} style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '12px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#5C4033' }}>
                  {clone.targetStaff} ← {clone.sourceStaff}の行動を移植
                </p>
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#52B788', fontFamily: 'Inter, sans-serif' }}>
                  +{yen(clone.totalImpact)}/月
                </span>
              </div>
              {clone.successActions.slice(0, 2).map(a => (
                <p key={a.id} style={{ fontSize: '10px', color: '#9F7E6C', lineHeight: 1.6, paddingLeft: '4px', borderLeft: '2px solid #F56E8B', marginBottom: '4px' }}>
                  {a.action}
                </p>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function StaffComparison() {
  const { staffRanking } = useKpiStore()
  if (staffRanking.length < 2) return null

  const sorted  = [...staffRanking].sort((a, b) => b.nextReserveCount - a.nextReserveCount)
  const top     = sorted[0]
  const bottom  = sorted[sorted.length - 1]
  const diff    = top.nextReserveCount - bottom.nextReserveCount
  if (diff === 0) return null

  // AI仮説（ルールベース）
  const hypothesis = `${top.name.split(' ')[0]}は施術終了10分前に次回予約を提案している可能性があります。`

  return (
    <div style={{
      background: '#fff', border: '1px solid #F5EEF0',
      borderRadius: '14px', padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: '8px',
    }}>
      <p style={{ fontSize: '11px', fontWeight: 700, color: '#5C4033' }}>
        📊 スタッフ比較（次回予約）
      </p>

      {sorted.slice(0, 3).map((s, i) => {
        const maxCount = sorted[0].nextReserveCount || 1
        const pctBar   = Math.round((s.nextReserveCount / maxCount) * 100)
        return (
          <div key={s.staffId} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '11px', minWidth: '44px', fontWeight: i === 0 ? 700 : 400,
              color: i === 0 ? '#5C4033' : '#C8A8B0',
            }}>
              {s.name.split(' ')[0]}
            </span>
            <div style={{ flex: 1, background: '#F5EEF0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pctBar}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: i * 0.1 }}
                style={{
                  height: '100%', borderRadius: '4px',
                  background: i === 0
                    ? 'linear-gradient(135deg, #52B788, #40A872)'
                    : '#EDE5DC',
                }}
              />
            </div>
            <span style={{
              fontSize: '11px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
              color: i === 0 ? '#52B788' : '#C8A8B0', minWidth: '32px', textAlign: 'right',
            }}>
              {s.nextReserveCount}件
            </span>
          </div>
        )
      })}

      {/* トップとの差 */}
      <div style={{
        padding: '8px 10px', background: '#F0FFF8',
        borderRadius: '10px', border: '1px solid #74C69D44',
      }}>
        <p style={{ fontSize: '10px', color: '#52B788', fontWeight: 600, marginBottom: '3px' }}>
          差: {top.name.split(' ')[0]} ＋{diff}件 / {bottom.name.split(' ')[0]}
        </p>
        <p style={{ fontSize: '10px', color: '#2D6A4F', lineHeight: 1.6 }}>
          💡 {hypothesis}
        </p>
      </div>
    </div>
  )
}

// ─── ③ AI改善TODO ─────────────────────────────────────────────────────────────

function DailyTodoList() {
  const { current } = useKpiStore()
  const customers   = useCustomerStore(s => s.customers)
  const total       = customers.length || 1

  const { todos, totalExpect } = useMemo(() => {
    const analysisInput = buildAnalysisInput({
      nextReserveRate:  current.nextReserveRate,
      repeatRate:       current.repeatRate,
      lineResponseRate: current.lineResponseRate,
      avgSpend:         current.avgSpend,
      vipRate:          current.vipRate,
      customers,
    })
    const impactResult = calcImprovementImpact({
      ...analysisInput,
      monthlyVisits:   total,
      avgSpend:        current.avgSpend || 14000,
      avgProductPrice: 4500,
    })
    return generateDailyTodos(
      customers,
      impactResult.items,
      current.avgSpend || 14000,
      4500,
    )
  }, [current, customers, total])

  if (todos.length === 0) return null

  return (
    <div style={{
      background: '#fff', border: '1px solid #F5EEF0',
      borderRadius: '14px', overflow: 'hidden',
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '10px 14px',
        background: 'linear-gradient(135deg, #FFF8F7, #FFF0F0)',
        borderBottom: '1px solid #F5EEF0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#5C4033' }}>
          ☀️ 今日やること
        </p>
        <span style={{
          fontSize: '10px', fontWeight: 700, color: '#52B788',
          fontFamily: 'Inter, sans-serif',
        }}>
          期待合計 {yen(totalExpect)}
        </span>
      </div>

      {todos.map((todo, i) => (
        <div key={todo.rank} style={{
          padding: '10px 14px',
          borderBottom: i < todos.length - 1 ? '1px solid #F8F0F2' : 'none',
          background: i % 2 === 0 ? '#fff' : '#FFFBF8',
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{
              fontSize: '11px', fontWeight: 700, minWidth: '18px',
              color: i === 0 ? '#EF476F' : i === 1 ? '#F56E8B' : '#C8A8B0',
              fontFamily: 'Inter, sans-serif', paddingTop: '1px',
            }}>
              {todo.rank}
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', marginBottom: '3px' }}>
                {todo.action}
              </p>
              {todo.detail && (
                <p style={{ fontSize: '10px', color: '#9F7E6C', marginBottom: '4px' }}>
                  {todo.detail}
                </p>
              )}
              <span style={{
                fontSize: '10px', fontWeight: 700, color: '#52B788',
                fontFamily: 'Inter, sans-serif',
              }}>
                期待売上 +{yen(todo.expectedRevenue)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── メインコンポーネント（全セクションをまとめる） ────────────────────────────

export default function SalesImprovementRanking() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <DailyTodoList />
      <SuccessCloneRanking />
      <StaffComparison />
      <SuccessPatternCard />
    </div>
  )
}

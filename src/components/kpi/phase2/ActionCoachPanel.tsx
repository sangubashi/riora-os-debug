'use client'
import { useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKpiStore }                    from '@/store/useKpiStore'
import { useCustomerStore }               from '@/store/useCustomerStore'
import { DEMO_MODE }                      from '@/lib/supabase'
import { analyzeSuccessPatterns }         from '@/lib/analytics/SuccessPatternAnalyzer'
import { calcImprovementImpact }          from '@/lib/analytics/ImprovementImpactCalculator'
import { buildAnalysisInput }             from '@/lib/analytics/ImprovementAnalyzer'
import { generateCoachTasks, type CoachTask, type CoachPriority } from '@/lib/analytics/ActionCoachGenerator'
import { useImprovementLogStore, ACTION_TYPE_LABEL } from '@/store/useImprovementLogStore'
import type { CoachActionType } from '@/types'

// ─── metric → action_type マッピング ─────────────────────────────────────────

const METRIC_TO_ACTION: Record<string, CoachActionType> = {
  nextReserveRate:  'rebook_proposal',
  retailRate:       'product_suggest',
  vipRate:          'vip_upgrade',
  lineResponseAvg:  'line_follow',
}

// ─── 優先度スタイル ───────────────────────────────────────────────────────────

const P_META: Record<CoachPriority, { label: string; color: string; bg: string }> = {
  high:   { label: 'HIGH',   color: '#EF476F', bg: '#FFF0F0' },
  medium: { label: 'MEDIUM', color: '#F56E8B', bg: '#FFF8F7' },
  low:    { label: 'LOW',    color: '#C8A8B0', bg: '#FAFAFA' },
}

function yen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

// ─── タスクカード ─────────────────────────────────────────────────────────────

function TaskCard({ task, index, expanded, onToggle }: {
  task: CoachTask; index: number; expanded: boolean; onToggle: () => void
}) {
  const p = P_META[task.priority]
  const { addLog, getStats } = useImprovementLogStore()
  const [completing, setCompleting] = useState(false)
  const [done,       setDone]       = useState(false)

  // 過去30日の成功率を取得
  const actionType: CoachActionType = METRIC_TO_ACTION[task.metric] ?? 'other'
  const stats = getStats()
  const stat  = stats.find(s => s.actionType === actionType)

  const handleComplete = useCallback(async () => {
    if (done) return
    setCompleting(true)
    try {
      await addLog({
        staff_name:               task.staffName,
        action_type:              actionType,
        customer_id:              null,
        customer_name:            task.targetNames.join(', '),
        metric:                   task.metric,
        completed_at:             new Date().toISOString(),
        result_type:              'success',
        revenue_generated:        task.expectedImpact,
        revenue_generated_actual: null,
        attribution_linked_at:    null,
        success:                  true,
        notes:                    task.title,
      })
      setDone(true)
    } finally {
      setCompleting(false)
    }
  }, [done, addLog, task, actionType])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: done ? 0.5 : 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      style={{
        background: done ? '#F8F8F8' : '#fff',
        border: `1px solid ${done ? '#E0E0E0' : p.color + '33'}`,
        borderRadius: '14px', overflow: 'hidden',
      }}
    >
      {/* ヘッダー行 */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '11px 14px', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
          background: done ? '#E0E0E022' : p.color + '22',
          color: done ? '#C0C0C0' : p.color,
          border: `1px solid ${done ? '#E0E0E0' : p.color + '44'}`, flexShrink: 0,
        }}>
          {done ? '✓ 完了' : p.label}
        </span>
        <p style={{ fontSize: '12px', fontWeight: 700, color: done ? '#C0C0C0' : '#5C4033', flex: 1 }}>
          {task.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#52B788', fontFamily: 'Inter, sans-serif' }}>
            +{yen(task.expectedImpact)}
          </span>
          <span style={{ fontSize: '10px', color: '#C8A8B0' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* ROI・成功率バッジ */}
      {stat && stat.totalCount > 0 && !done && (
        <div style={{ padding: '0 14px 8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {stat.avgRevenue > 0 && (
            <span style={{
              fontSize: '9px', padding: '2px 8px', borderRadius: '4px',
              background: '#F0F8FF', color: '#4878A8', border: '1px solid #B8D4F044',
            }}>
              ROI {Math.round(stat.avgRevenue / 500)}× （平均 {yen(stat.avgRevenue)}/件）
            </span>
          )}
          <span style={{
            fontSize: '9px', padding: '2px 8px', borderRadius: '4px',
            background: stat.successRate >= 70 ? '#E8F5F0' : '#FFF8F0',
            color:      stat.successRate >= 70 ? '#52B788'  : '#F56E8B',
            border:     `1px solid ${stat.successRate >= 70 ? '#74C69D44' : '#F56E8B44'}`,
          }}>
            成功率 {stat.successRate}%
          </span>
        </div>
      )}

      {/* 展開コンテンツ */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '0 14px 12px', borderTop: `1px solid ${p.color}22`,
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingTop: '8px' }}>
                <span style={{
                  fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                  background: '#F8F5F0', color: '#9F7E6C', border: '1px solid #EDE5DC',
                }}>
                  {task.staffName}
                </span>
                <span style={{ fontSize: '10px', color: '#C8A8B0' }}>対象 {task.targetCount}名</span>
              </div>

              <div style={{ padding: '7px 10px', background: '#FBF3F5', borderRadius: '8px' }}>
                <p style={{ fontSize: '10px', color: '#9F7E6C', fontWeight: 600, marginBottom: '2px' }}>理由</p>
                <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>{task.reason}</p>
              </div>

              <div style={{ padding: '7px 10px', background: '#F0F8FF', borderRadius: '8px', border: '1px solid #B8D4F0' }}>
                <p style={{ fontSize: '10px', color: '#4878A8', fontWeight: 600, marginBottom: '2px' }}>推奨アクション</p>
                <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>{task.action}</p>
              </div>

              {task.targetNames.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {task.targetNames.map(name => (
                    <span key={name} style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                      background: '#F0FFF8', color: '#2D6A4F', border: '1px solid #74C69D44',
                    }}>
                      {name.split(/\s/)[0]}様
                    </span>
                  ))}
                </div>
              )}

              {/* 完了ボタン */}
              {!done && (
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={handleComplete}
                  disabled={completing}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '10px', border: 'none',
                    background: completing ? '#F5EEF0' : 'linear-gradient(135deg, #52B788, #40A872)',
                    color: completing ? '#C8A8B0' : '#fff',
                    fontSize: '12px', fontWeight: 700, cursor: completing ? 'not-allowed' : 'pointer',
                  }}>
                  {completing ? '記録中…' : '✓ 完了 — 実績を記録'}
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── 月次実績サマリー ─────────────────────────────────────────────────────────

function MonthlyResultBanner() {
  const { getMonthTotal, getAccuracy } = useImprovementLogStore()
  const { totalRevenue, successCount, totalCount } = getMonthTotal()
  const accuracy = getAccuracy()

  if (totalCount === 0) return null

  const successRate = Math.round((successCount / totalCount) * 100)
  const hasActual   = accuracy.linkedCount > 0

  return (
    <div style={{
      background: 'linear-gradient(135deg, #F0FFF8, #E8F8F0)',
      borderRadius: '14px', border: '1px solid #74C69D44',
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px',
    }}>
      <p style={{ fontSize: '10px', color: '#52B788', fontWeight: 600 }}>今月AI改善効果</p>

      {/* 予測 / 実売上 / 精度 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <p style={{ fontSize: '9px', color: '#74C69D', marginBottom: '2px' }}>予測売上</p>
          <p style={{ fontSize: '16px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>
            {yen(hasActual ? accuracy.predictedTotal : totalRevenue)}
          </p>
        </div>
        {hasActual && (
          <>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontSize: '9px', color: '#74C69D', marginBottom: '2px' }}>実売上</p>
              <p style={{ fontSize: '16px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>
                {yen(accuracy.actualTotal)}
              </p>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontSize: '9px', color: '#74C69D', marginBottom: '2px' }}>精度</p>
              <p style={{ fontSize: '16px', fontWeight: 700, color: accuracy.accuracyPct >= 80 ? '#52B788' : '#FFD166', fontFamily: 'Inter, sans-serif' }}>
                {accuracy.accuracyPct}%
              </p>
            </div>
          </>
        )}
        {!hasActual && (
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ fontSize: '9px', color: '#74C69D', marginBottom: '2px' }}>成功率</p>
            <p style={{ fontSize: '16px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>
              {successRate}%
            </p>
          </div>
        )}
      </div>

      <p style={{ fontSize: '9px', color: '#74C69D', textAlign: 'right' }}>
        実行 {totalCount}件{hasActual ? ` / 紐付け済み ${accuracy.linkedCount}件` : ''}
      </p>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function ActionCoachPanel() {
  const { current, staffRanking } = useKpiStore()
  const customers = useCustomerStore(s => s.customers)
  const { fetchLogs, runRevenueAttribution, getAccuracy } = useImprovementLogStore()
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)

  useMemo(() => { fetchLogs() }, [fetchLogs])

  // Attribution 自動実行（customers 取得後）
  useMemo(() => {
    if (customers.length > 0) runRevenueAttribution(customers)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers.length])

  const result = useMemo(() => {
    const successResult = analyzeSuccessPatterns(
      customers, staffRanking, current.avgSpend || 14000, customers.length || 30, DEMO_MODE,
    )
    const analysisInput = buildAnalysisInput({
      nextReserveRate:  current.nextReserveRate,
      repeatRate:       current.repeatRate,
      lineResponseRate: current.lineResponseRate,
      avgSpend:         current.avgSpend,
      vipRate:          current.vipRate,
      customers,
    })
    const { items: impactItems } = calcImprovementImpact({
      ...analysisInput,
      monthlyVisits:   customers.length || 1,
      avgSpend:        current.avgSpend || 14000,
      avgProductPrice: 4500,
    })
    return generateCoachTasks({
      patterns:     successResult.patterns,
      customers,
      staffRanking,
      impactItems,
      demoMode:     DEMO_MODE,
    })
  }, [customers, staffRanking, current])

  if (result.tasks.length === 0) return null

  const highCount   = result.tasks.filter(t => t.priority === 'high').length
  const totalImpact = result.tasks.reduce((s, t) => s + t.expectedImpact, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* 月次実績バナー */}
      <MonthlyResultBanner />

      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>☀️</span>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>今日のAIコーチ</p>
          {highCount > 0 && (
            <span style={{
              fontSize: '9px', padding: '2px 7px', borderRadius: '999px',
              background: '#EF476F22', color: '#EF476F', border: '1px solid #EF476F44', fontWeight: 600,
            }}>
              HIGH {highCount}件
            </span>
          )}
        </div>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#52B788', fontFamily: 'Inter, sans-serif' }}>
          期待 +{yen(totalImpact)}/週
        </span>
      </div>

      {result.tasks.slice(0, 6).map((task, i) => (
        <TaskCard key={`${task.staffName}-${task.metric}`}
          task={task} index={i}
          expanded={expandedIdx === i}
          onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
        />
      ))}

      {result.tasks.length > 6 && (
        <p style={{ fontSize: '10px', color: '#C8A8B0', textAlign: 'center' }}>
          他 {result.tasks.length - 6} 件
        </p>
      )}
    </div>
  )
}

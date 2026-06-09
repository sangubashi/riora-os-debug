'use client'
/**
 * StaffImprovementPanel.tsx — スタッフ改善分析
 * useKpiStore の staffRanking を利用。
 * ランキングではなく強み・改善ポイントを提示する。
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useKpiStore }        from '@/store/useKpiStore'
import ImprovementInsightCard  from './ImprovementInsightCard'
import SalesImprovementRanking from './SalesImprovementRanking'
import ActionCoachPanel        from './ActionCoachPanel'

// ─── スタッフごとの強み・改善ポイント判定 ─────────────────────────────────────

interface StaffAnalysis {
  strengths: string[]
  improvements: string[]
  advice: string
}

const STORE_TOTAL_NEXT_RESERVE_RATE = 74 // % 全体平均（モック）
const STORE_AVG_AI_ADOPT            = 84 // % 全体平均（モック）

function analyzeStaff(
  todaySales:       number,
  nextReserveCount: number,
  aiAdoptRate:      number,
  allSales:         number[],
  allReserve:       number[],
): StaffAnalysis {
  const strengths:    string[] = []
  const improvements: string[] = []

  const salesAvg   = allSales.reduce((a, b) => a + b, 0) / (allSales.length || 1)
  const reserveAvg = allReserve.reduce((a, b) => a + b, 0) / (allReserve.length || 1)

  // 強み判定
  if (todaySales >= salesAvg * 1.1)         strengths.push('本日売上が全体平均を上回っています')
  if (nextReserveCount >= reserveAvg * 1.1) strengths.push('次回予約取得率が高い')
  if (aiAdoptRate >= STORE_AVG_AI_ADOPT)    strengths.push(`AI提案採用率 ${aiAdoptRate}% — 平均以上`)

  // 改善ポイント
  if (todaySales < salesAvg * 0.9)          improvements.push('本日売上が平均を下回っています')
  if (nextReserveCount < reserveAvg * 0.9)  improvements.push('次回予約の声かけを増やしましょう')
  if (aiAdoptRate < STORE_AVG_AI_ADOPT)     improvements.push(`AI提案採用率 ${aiAdoptRate}% — 活用を増やすと◎`)

  // アドバイス（最重要改善項目）
  let advice = '引き続き丁寧な接客を続けてください。'
  if (improvements.includes('次回予約の声かけを増やしましょう')) {
    advice = '施術の仕上がりに触れながら「次回はいつ頃にしましょうか」と自然に提案するタイミングを意識してみてください。'
  } else if (improvements.includes('本日売上が平均を下回っています')) {
    advice = 'オプション提案のタイミングを施術中盤に変えると成約率が上がりやすいです。'
  } else if (aiAdoptRate < STORE_AVG_AI_ADOPT) {
    advice = 'AI提案を積極的に活用してみてください。顧客ごとの最適なアプローチが自動提示されます。'
  }

  if (strengths.length === 0) strengths.push('データ蓄積中です')

  return { strengths, improvements, advice }
}

// ─── スタッフカード ───────────────────────────────────────────────────────────

function StaffCard({ item, analysis, allSales }: {
  item:      ReturnType<typeof useKpiStore.getState>['staffRanking'][number]
  analysis:  StaffAnalysis
  allSales:  number[]
}) {
  const salesAvg = allSales.reduce((a, b) => a + b, 0) / (allSales.length || 1)
  const salesPct = salesAvg > 0 ? Math.round((item.todaySales / salesAvg) * 100) : 0

  return (
    <div style={{
      background: '#fff', border: '1px solid #F5EEF0',
      borderRadius: '18px', overflow: 'hidden', marginBottom: '12px',
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '12px 16px',
        background: 'linear-gradient(135deg, #FFF8F7, #FFFBF8)',
        borderBottom: '1px solid #F5EEF0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{item.name}</p>
        <span style={{
          fontSize: '11px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
          color: salesPct >= 100 ? '#52B788' : '#F56E8B',
        }}>
          ¥{item.todaySales.toLocaleString()}
        </span>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

        {/* 数値サマリー */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { label: '本日売上',     value: `¥${Math.round(item.todaySales / 1000)}K`,  color: salesPct >= 100 ? '#52B788' : '#F56E8B' },
            { label: '次回予約',     value: `${item.nextReserveCount}件`,                 color: '#4878A8' },
            { label: 'AI採用率',     value: `${item.aiAdoptRate}%`,                       color: item.aiAdoptRate >= STORE_AVG_AI_ADOPT ? '#52B788' : '#FFD166' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, background: '#FFFBF8', borderRadius: '10px',
              padding: '8px 6px', textAlign: 'center', border: '1px solid #F5EEF0',
            }}>
              <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
              <p style={{ fontSize: '14px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* 強み */}
        {analysis.strengths.length > 0 && (
          <div>
            <p style={{ fontSize: '10px', color: '#52B788', fontWeight: 600, marginBottom: '4px' }}>
              ✓ 強み
            </p>
            {analysis.strengths.map(s => (
              <p key={s} style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6, paddingLeft: '8px' }}>
                {s}
              </p>
            ))}
          </div>
        )}

        {/* 改善ポイント */}
        {analysis.improvements.length > 0 && (
          <div>
            <p style={{ fontSize: '10px', color: '#F56E8B', fontWeight: 600, marginBottom: '4px' }}>
              △ 改善ポイント
            </p>
            {analysis.improvements.map(s => (
              <p key={s} style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.6, paddingLeft: '8px' }}>
                {s}
              </p>
            ))}
          </div>
        )}

        {/* アドバイス */}
        <div style={{
          background: '#F8F5FF', borderRadius: '10px', padding: '10px 12px',
          border: '1px solid #E8E0F8',
        }}>
          <p style={{ fontSize: '9px', color: '#9878C8', fontWeight: 600, marginBottom: '4px' }}>
            推奨アクション
          </p>
          <p style={{ fontSize: '11px', color: '#5C4033', lineHeight: 1.7 }}>
            {analysis.advice}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function StaffImprovementPanel() {
  const { staffRanking, fetchStaffRanking } = useKpiStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (staffRanking.length === 0) fetchStaffRanking()
  }, [staffRanking.length, fetchStaffRanking])

  useEffect(() => {
    if (staffRanking.length > 0 && !selectedId) {
      setSelectedId(staffRanking[0].staffId)
    }
  }, [staffRanking, selectedId])

  const allSales   = staffRanking.map(s => s.todaySales)
  const allReserve = staffRanking.map(s => s.nextReserveCount)

  const selected = selectedId
    ? staffRanking.find(s => s.staffId === selectedId) ?? staffRanking[0]
    : staffRanking[0]

  if (staffRanking.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <p style={{ fontSize: '12px', color: '#C8A8B0' }}>スタッフデータがありません</p>
      </div>
    )
  }

  const analysis = selected
    ? analyzeStaff(selected.todaySales, selected.nextReserveCount, selected.aiAdoptRate, allSales, allReserve)
    : null

  return (
    <div style={{ padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* 今日のAIコーチ（最上部） */}
      <ActionCoachPanel />

      {/* スタッフ選択タブ */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        {staffRanking.map(staff => (
          <button key={staff.staffId}
            onClick={() => setSelectedId(staff.staffId)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: '12px', cursor: 'pointer',
              border: `1px solid ${selectedId === staff.staffId ? '#F56E8B' : '#F0E8E8'}`,
              background: selectedId === staff.staffId ? 'rgba(245,110,139,0.08)' : '#fff',
              color: selectedId === staff.staffId ? '#F56E8B' : '#9F7E6C',
              fontSize: '12px', fontWeight: selectedId === staff.staffId ? 700 : 400,
              transition: 'all 0.15s',
            }}>
            {staff.name.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* 選択中スタッフの分析カード */}
      {selected && analysis && (
        <motion.div
          key={selected.staffId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <StaffCard item={selected} analysis={analysis} allSales={allSales} />
        </motion.div>
      )}

      {/* 全体比較バー */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0',
        borderRadius: '14px', padding: '12px 14px',
      }}>
        <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600, marginBottom: '10px' }}>
          全体比較
        </p>
        {staffRanking.map((s, i) => {
          const maxSales = Math.max(...allSales, 1)
          const pct      = Math.round((s.todaySales / maxSales) * 100)
          const isActive = s.staffId === selectedId
          return (
            <div key={s.staffId} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: i < staffRanking.length - 1 ? '8px' : 0,
            }}>
              <span style={{
                fontSize: '11px', color: isActive ? '#5C4033' : '#C8A8B0',
                minWidth: '44px', fontWeight: isActive ? 700 : 400,
              }}>
                {s.name.split(' ')[0]}
              </span>
              <div style={{ flex: 1, background: '#F5EEF0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  style={{
                    height: '100%', borderRadius: '4px',
                    background: isActive
                      ? 'linear-gradient(135deg, #F56E8B, #F0487A)'
                      : '#EDE5DC',
                  }}
                />
              </div>
              <span style={{
                fontSize: '10px', fontFamily: 'Inter, sans-serif',
                color: isActive ? '#F56E8B' : '#C8A8B0', minWidth: '48px', textAlign: 'right',
              }}>
                ¥{Math.round(s.todaySales / 1000)}K
              </span>
            </div>
          )
        })}
      </div>

      {/* AI改善分析 */}
      <ImprovementInsightCard />

      {/* 改善インパクトランキング + スタッフ比較 + 今日やること */}
      <SalesImprovementRanking />
    </div>
  )
}

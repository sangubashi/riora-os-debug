'use client'
/**
 * CustomerAnalyticsPanel.tsx  — AI店舗学習パネル
 *
 * KPI画面に差し込む。フェーズ別売上・上位顧客の特徴・AIインサイトを表示。
 * 既存KpiDashboardのデザイントークンを踏襲。UIデザイン変更禁止。
 */
import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAnalyticsStore } from '@/store/useAnalyticsStore'
import { CUSTOMER_PHASE_COLOR } from '@/types'
import { DEMO_MODE } from '@/lib/supabase'

function formatYen(n: number): string {
  if (n >= 10000) return `¥${Math.round(n / 10000)}万`
  return `¥${n.toLocaleString()}`
}

function CustomerAnalyticsPanel() {
  // DEMO_MODE: ダミーデータで計算
  const result = useAnalyticsStore(s => s.customer)

  if (!DEMO_MODE && result.totalCustomers === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── セクションタイトル ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
        <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em' }}>
          🧠 AI店舗学習
        </p>
        <span style={{
          fontSize: '9px', background: '#FFF0F4', color: '#F56E8B',
          padding: '1px 6px', borderRadius: '999px', border: '1px solid #FCCDD8',
        }}>
          {result.totalCustomers}名分析
        </span>
      </div>

      {/* ── フェーズ別平均売上 ── */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0', borderRadius: '18px', padding: '16px',
      }}>
        <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, marginBottom: '12px' }}>
          フェーズ別平均売上
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {result.phaseStats.map((s, i) => (
            <motion.div key={s.phase}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
            >
              {/* フェーズバッジ */}
              <span style={{
                fontSize: '10px', fontWeight: 700, minWidth: '60px',
                color: CUSTOMER_PHASE_COLOR[s.phase],
              }}>
                {s.label}
              </span>
              {/* バー */}
              <div style={{ flex: 1, background: '#F5EEF0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{
                  background: CUSTOMER_PHASE_COLOR[s.phase],
                  width: `${Math.min(100, Math.round(s.avgSales / 350000 * 100))}%`,
                  height: '100%', borderRadius: '4px',
                  transition: 'width 0.6s ease',
                }} />
              </div>
              {/* 数値 */}
              <span style={{
                fontSize: '11px', fontWeight: 600, color: '#5C4033',
                minWidth: '52px', textAlign: 'right', fontFamily: 'Inter, sans-serif',
              }}>
                {formatYen(s.avgSales)}
              </span>
              <span style={{ fontSize: '10px', color: '#C8A8B0', minWidth: '28px' }}>
                {s.count}名
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── 上位20%の共通特徴 ── */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0', borderRadius: '18px', padding: '16px',
      }}>
        <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, marginBottom: '12px' }}>
          🏆 上位{result.topProfile.count}名の特徴
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[
            { label: '平均来店回数',   value: `${result.topProfile.avgVisits}回` },
            { label: 'LINE返信率',     value: `${result.topProfile.avgLineResponse}%` },
            { label: '平均累計売上',   value: formatYen(result.topProfile.avgSales) },
            { label: '店販購入率',     value: `${result.topProfile.purchaseRate}%` },
          ].map(item => (
            <div key={item.label} style={{
              background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px',
              border: '1px solid #F5EEF0',
            }}>
              <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '3px' }}>{item.label}</p>
              <p style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── AIインサイト ── */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0', borderRadius: '18px', padding: '16px',
      }}>
        <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, marginBottom: '10px' }}>
          💡 AIインサイト
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {result.insights.map((insight, i) => (
            <motion.div key={insight.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '8px 10px', background: '#FFF8F7',
                borderRadius: '10px', border: '1px solid #F5EEF0',
              }}
            >
              <span style={{ fontSize: '12px', flexShrink: 0, marginTop: '1px' }}>✨</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.5 }}>
                  {insight.message}
                </p>
              </div>
              {insight.metric && (
                <span style={{
                  fontSize: '12px', fontWeight: 700, color: '#F56E8B',
                  flexShrink: 0, fontFamily: 'Inter, sans-serif',
                }}>
                  {insight.metric}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>

    </div>
  )
}

CustomerAnalyticsPanel.displayName = 'CustomerAnalyticsPanel'
export default memo(CustomerAnalyticsPanel)

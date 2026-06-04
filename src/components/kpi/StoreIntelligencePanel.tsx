'use client'
/**
 * StoreIntelligencePanel.tsx  — PHASE 8
 * 店舗の成功パターン・季節傾向・改善ヒントを自然表示。
 * KpiDashboard の insights 直下に差し込む。
 * UIデザイン変更禁止。既存 KpiDashboard スタイルを踏襲。
 */
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { fetchStoreIntelligence, fetchSuccessPatterns } from '@/lib/phase8/successPatternEngine'
import type { StoreIntelligence, SuccessPattern } from '@/types'

export default function StoreIntelligencePanel() {
  const [intel,    setIntel]    = useState<StoreIntelligence | null>(null)
  const [patterns, setPatterns] = useState<SuccessPattern[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.allSettled([
      fetchStoreIntelligence(),
      fetchSuccessPatterns(),
    ]).then(([i, p]) => {
      if (i.status === 'fulfilled') setIntel(i.value)
      if (p.status === 'fulfilled') setPatterns(p.value.slice(0, 2))
      setLoading(false)
    })
  }, [])

  if (loading) return null  // ロード中は非表示（邪魔しない）
  if (!intel)  return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="mx-4 mb-5"
    >
      {/* ヘッダー */}
      <div className="flex items-center mb-2.5">
        <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>
          STORE INTELLIGENCE
        </span>
      </div>

      <div
        className="rounded-2xl p-4"
        style={{ background: '#FFFFFF', border: '1px solid #F2E8EC', boxShadow: '0 1px 8px rgba(92,64,51,0.04)' }}
      >
        {/* 週次ヒント（最重要） */}
        <div style={{ marginBottom: '12px' }}>
          <p style={{ fontSize: '10px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.12em', marginBottom: '5px' }}>
            💡 今週の改善ポイント
          </p>
          <p style={{ fontSize: '13px', color: '#5C4033', lineHeight: 1.7 }}>
            {intel.weeklyHint}
          </p>
        </div>

        {/* 季節傾向 */}
        <div style={{ background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px', marginBottom: '10px' }}>
          <p style={{ fontSize: '10px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '4px' }}>🌸 今の季節傾向</p>
          <p style={{ fontSize: '12px', color: '#9F7E6C', lineHeight: 1.6 }}>{intel.seasonalTrends}</p>
        </div>

        {/* 売れ筋施術 */}
        {intel.topMenus.length > 0 && intel.topMenus[0] !== 'データ集計中' && (
          <div style={{ marginBottom: '10px' }}>
            <p style={{ fontSize: '10px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '5px' }}>📊 直近の売れ筋</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {intel.topMenus.map((m, i) => (
                <span key={i} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '999px', background: i === 0 ? 'rgba(245,110,139,0.08)' : '#F8F1F3', color: i === 0 ? '#F56E8B' : '#9F7E6C', border: `1px solid ${i === 0 ? 'rgba(245,110,139,0.2)' : '#F0E8E8'}`, fontWeight: i === 0 ? 500 : 400 }}>
                  {i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}{m}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 成功パターン（直近90日） */}
        {patterns.length > 0 && (
          <div>
            <p style={{ fontSize: '10px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '5px' }}>✅ 成功パターン（直近90日）</p>
            {patterns.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: i < patterns.length - 1 ? '6px' : 0 }}>
                <span style={{ fontSize: '11px', color: '#C8A58C', flexShrink: 0, marginTop: '1px' }}>×{p.outcome.successScore}%</span>
                <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>
                  {p.actionContent}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

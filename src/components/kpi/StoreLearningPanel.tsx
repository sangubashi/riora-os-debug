'use client'
/**
 * StoreLearningPanel.tsx  — AI店舗学習 v1 パネル
 * VIP・施術・商品分析を統合した成功法則を表示する。
 * KPI画面に差し込む。既存デザイントークンを踏襲。
 */
import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAnalyticsStore } from '@/store/useAnalyticsStore'
import type { StoreLearningRule }     from '@/types'

const CATEGORY_ICON: Record<StoreLearningRule['category'], string> = {
  treatment: '💆',
  product:   '🛍',
  behavior:  '💬',
  cycle:     '📅',
}

const IMPACT_COLOR = (score: number): string =>
  score >= 90 ? '#EF476F' :
  score >= 75 ? '#F56E8B' :
  score >= 60 ? '#FFD166' : '#74C69D'

function StoreLearningPanel() {
  const result = useAnalyticsStore(s => s.learning)

  if (result.rules.length === 0) return null

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>

      {/* タイトル */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', paddingTop:'4px' }}>
        <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, letterSpacing:'0.1em' }}>
          🧠 AI店舗学習
        </p>
        <span style={{ fontSize:'9px', background:'#F0F8FF', color:'#4878A8',
          padding:'1px 6px', borderRadius:'999px', border:'1px solid #B8D4F0' }}>
          成功法則 {result.rules.length}件
        </span>
      </div>

      {/* サマリ */}
      <div style={{ background:'#F0F8FF', borderRadius:'14px', padding:'10px 14px',
        border:'1px solid #B8D4F0' }}>
        <p style={{ fontSize:'11px', color:'#4878A8', lineHeight:1.6 }}>
          ✨ {result.summary}
        </p>
      </div>

      {/* 成功法則カード一覧 */}
      <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
        {result.rules.map((rule, i) => {
          const barColor  = IMPACT_COLOR(rule.impact)
          const icon      = CATEGORY_ICON[rule.category]

          return (
            <motion.div key={rule.rank}
              initial={{ opacity:0, y:6 }}
              animate={{ opacity:1, y:0 }}
              transition={{ delay: i * 0.07 }}
              style={{ background:'#fff', border:`1px solid ${barColor}33`,
                borderRadius:'16px', padding:'14px 16px',
                boxShadow:`0 2px 8px ${barColor}14` }}
            >
              {/* ヘッダー行 */}
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                <span style={{ fontSize:'14px' }}>{icon}</span>
                <span style={{ fontSize:'10px', fontWeight:700, color:'#fff',
                  background: barColor, padding:'1px 8px',
                  borderRadius:'999px', fontFamily:'Inter, sans-serif' }}>
                  成功法則 {rule.rank}
                </span>
                <span style={{ marginLeft:'auto', fontSize:'11px', fontWeight:700,
                  color: barColor, fontFamily:'Inter, sans-serif' }}>
                  影響度 {rule.impact}
                </span>
              </div>

              {/* 因果関係 */}
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                <span style={{ fontSize:'13px', fontWeight:700, color:'#5C4033', flex:1 }}>
                  {rule.title}
                </span>
                <span style={{ fontSize:'12px', color:'#9F7E6C' }}>→</span>
                <span style={{ fontSize:'12px', fontWeight:600, color: barColor }}>
                  {rule.effect}
                </span>
              </div>

              {/* 影響度バー */}
              <div style={{ background:'#F5EEF0', borderRadius:'4px', height:'5px',
                overflow:'hidden', marginBottom:'6px' }}>
                <motion.div
                  initial={{ width:0 }}
                  animate={{ width:`${rule.impact}%` }}
                  transition={{ delay: i*0.07 + 0.2, duration:0.6, ease:'easeOut' }}
                  style={{ background:`linear-gradient(90deg, ${barColor}88, ${barColor})`,
                    height:'100%', borderRadius:'4px' }}
                />
              </div>

              {/* 根拠 */}
              <p style={{ fontSize:'10px', color:'#C8A8B0' }}>
                📊 {rule.evidence}
              </p>
            </motion.div>
          )
        })}
      </div>

    </div>
  )
}

StoreLearningPanel.displayName = 'StoreLearningPanel'
export default memo(StoreLearningPanel)

'use client'
/**
 * ServiceReplayCard.tsx  — PHASE 5
 * 接客ログ保存後に表示する「接客リプレイ」カード。
 * 既存 log ページ（SHEET B）の保存ボタン押下後に fade-in する。
 * UIデザイン変更禁止。既存スタイル踏襲。
 */
import { memo } from 'react'
import { motion } from 'framer-motion'
import type { ServiceReplay } from '@/types'

interface ServiceReplayCardProps {
  replay: ServiceReplay
}

const ServiceReplayCardInner = function ServiceReplayCard({ replay }: ServiceReplayCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{ background: '#F8F5F0', borderRadius: '22px', padding: '16px', border: '1px solid #EDE5DC' }}
    >
      <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#A08060', fontWeight: 600, marginBottom: '12px' }}>
        ✨ 今日の接客リプレイ
      </p>

      {/* 良かった点 */}
      {replay.strengths.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <p style={{ fontSize: '10px', color: '#34A070', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '5px' }}>💪 良かった点</p>
          {replay.strengths.map((s, i) => (
            <p key={i} style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.65, marginBottom: '3px' }}>・{s}</p>
          ))}
        </div>
      )}

      {/* 次回改善 */}
      {replay.suggestions.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <p style={{ fontSize: '10px', color: '#A07020', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '5px' }}>🔧 次回さらに良くするために</p>
          {replay.suggestions.map((s, i) => (
            <p key={i} style={{ fontSize: '12px', color: '#9F7E6C', lineHeight: 1.65, marginBottom: '3px' }}>・{s}</p>
          ))}
        </div>
      )}

      {/* タイミング・流れ評価 */}
      <div style={{ background: '#fff', borderRadius: '14px', padding: '10px 12px', border: '1px solid #F0E8E8', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>
          <span style={{ color: '#C8A58C', fontWeight: 500 }}>タイミング: </span>{replay.timing}
        </p>
        <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>
          <span style={{ color: '#C8A58C', fontWeight: 500 }}>流れ: </span>{replay.flow}
        </p>
      </div>
    </motion.div>
  )
}

export default memo(ServiceReplayCardInner)

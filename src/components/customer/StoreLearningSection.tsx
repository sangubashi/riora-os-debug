'use client'
/**
 * StoreLearningSection.tsx
 *
 * 既存 BottomSheet の inline style を完全踏襲。
 * Tailwind クラスは使用しない（BottomSheet 統一ルール）。
 * UIデザイン変更禁止。
 */

import { motion } from 'framer-motion'
import type { StoreLearning } from '@/types/storeLearning'

interface Props {
  learnings: StoreLearning[]
  /** true = score が low の時など省スペース表示 */
  compact?: boolean
}

export default function StoreLearningSection({
  learnings,
  compact = false,
}: Props) {
  if (learnings.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* ヘッダー */}
      <p style={{
        fontSize: '11px',
        letterSpacing: '0.18em',
        color: '#C8A58C',
        fontWeight: 600,
      }}>
        🧠 店舗学習AIの知見
      </p>

      {/* カード一覧 */}
      {learnings.map((learning, i) => (
        <motion.div
          key={`${learning.section}-${i}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: i * 0.06 }}
          style={{
            background: '#FFFFFF',
            border: '1px solid #F0E8E8',
            borderRadius: '16px',
            padding: compact ? '10px 12px' : '12px 14px',
          }}
        >
          {/* レコメンデーション本文 */}
          <p style={{
            fontSize: compact ? '11px' : '12px',
            color: '#5C4033',
            lineHeight: 1.7,
            marginBottom: '8px',
          }}>
            {learning.recommendation}
          </p>

          {/* フッター: 信頼度 + reasons */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
          }}>
            {/* 信頼度バッジ */}
            <span style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '999px',
              background: confidenceBg(learning.confidence),
              color: confidenceColor(learning.confidence),
              border: `1px solid ${confidenceBorder(learning.confidence)}`,
              fontWeight: 600,
            }}>
              信頼度 {Math.round(learning.confidence * 100)}%
            </span>

            {/* reasons */}
            {learning.reasons.map((reason, idx) => (
              <span key={idx} style={{
                fontSize: '10px',
                color: '#C8A8B0',
              }}>
                • {reason}
              </span>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ─── 信頼度に応じたバッジカラー ───────────────────────────────────────────────
// 既存 BottomSheet のカラートークンを踏襲

function confidenceBg(c: number): string {
  if (c >= 0.75) return 'rgba(52,160,112,0.08)'
  if (c >= 0.50) return '#FFFBF0'
  return '#F8F5F0'
}

function confidenceColor(c: number): string {
  if (c >= 0.75) return '#207850'
  if (c >= 0.50) return '#A07020'
  return '#9F7E6C'
}

function confidenceBorder(c: number): string {
  if (c >= 0.75) return 'rgba(52,160,112,0.25)'
  if (c >= 0.50) return 'rgba(160,112,32,0.25)'
  return 'rgba(159,126,108,0.2)'
}

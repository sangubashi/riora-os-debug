'use client'
/**
 * HandoverSection.tsx
 * AI Handover — 担当スタッフ変更時の引継ぎカード。
 * CustomerBottomSheet の Today's AI Brief 直下に配置する。
 *
 * 表示内容:
 *   - 顧客状況 (customer_context)
 *   - 未完了タスク (open_tasks)
 *   - 推奨アクション (recommended_actions)
 *   - 注意事項 (risk_flags)
 *   - サマリー (summary)
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { HandoverNote } from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface HandoverSectionProps {
  handover:   HandoverNote | null
  loading:    boolean
  collapsed?: boolean
  onToggle?:  () => void
}

// ─── サブセクション ───────────────────────────────────────────────────────────

interface RowItem {
  emoji:   string
  label:   string
  items:   string[]
  color:   string
  bgColor: string
}

function ItemRow({ emoji, label, items, color, bgColor }: RowItem) {
  if (items.length === 0) return null
  return (
    <div style={{ background: bgColor, borderRadius: '14px', padding: '9px 12px' }}>
      <p style={{
        fontSize:      '10px',
        fontWeight:    700,
        color,
        letterSpacing: '0.08em',
        margin:        '0 0 5px 0',
      }}>
        {emoji} {label}
      </p>
      {items.map((item, i) => (
        <p key={i} style={{ fontSize: '12px', color: '#4A3060', lineHeight: 1.6, margin: 0 }}>
          ・{item}
        </p>
      ))}
    </div>
  )
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

const HandoverSectionInner = memo(function HandoverSection({
  handover,
  loading,
  collapsed = false,
  onToggle,
}: HandoverSectionProps) {

  const hasData = !loading && handover !== null
  const isEmpty = !loading && handover === null

  return (
    <div
      data-testid="handover-section"
      style={{
        background:   'linear-gradient(135deg, #F0F5FF 0%, #FFF5F0 100%)',
        borderRadius: '22px',
        overflow:     'hidden',
        border:       '1px solid #D8E5F5',
      }}
    >
      {/* ヘッダー */}
      <button
        onClick={onToggle}
        style={{
          width:          '100%',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '13px 16px',
          background:     'transparent',
          border:         'none',
          cursor:         onToggle ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '15px' }}>🤝</span>
          <p style={{
            fontSize:      '12px',
            fontWeight:    700,
            letterSpacing: '0.06em',
            color:         '#3050A8',
            margin:        0,
          }}>
            AI Handover
          </p>
          {hasData && (
            <span style={{
              fontSize:     '9px',
              padding:      '1px 7px',
              borderRadius: '999px',
              background:   'rgba(48,80,168,0.10)',
              color:        '#3050A8',
              fontWeight:   600,
            }}>
              {Math.round((handover?.confidence ?? 0) * 100)}%
            </span>
          )}
        </div>
        {onToggle && (
          <span style={{
            fontSize:   '13px',
            color:      '#6080C8',
            transition: 'transform 0.2s',
            display:    'inline-block',
            transform:  collapsed ? 'none' : 'rotate(180deg)',
          }}>
            ▾
          </span>
        )}
      </button>

      {/* ローディング */}
      {loading && (
        <div style={{ padding: '4px 16px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <motion.span
            animate={{ opacity: [0.3, 0.9, 0.3] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontSize: '11px', color: '#6080C8' }}
          >
            🤝
          </motion.span>
          <p style={{ fontSize: '12px', color: '#6080C8', margin: 0 }}>引継ぎノートを生成中…</p>
        </div>
      )}

      {/* データなし */}
      {isEmpty && (
        <div style={{ padding: '4px 16px 14px' }}>
          <p style={{ fontSize: '11px', color: '#90A0D0', margin: 0 }}>
            音声メモを録音すると引継ぎノートが自動生成されます
          </p>
        </div>
      )}

      {/* コンテンツ */}
      <AnimatePresence initial={false}>
        {hasData && !collapsed && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding:       '0 14px 14px',
              display:       'flex',
              flexDirection: 'column',
              gap:           '7px',
            }}>

              {/* サマリー */}
              {handover!.summary && (
                <div style={{
                  background:   '#fff',
                  borderRadius: '14px',
                  padding:      '10px 12px',
                  border:       '1px solid #D8E5F5',
                }}>
                  <p style={{
                    fontSize:   '12px',
                    color:      '#3A4060',
                    lineHeight: 1.7,
                    margin:     0,
                  }}>
                    {handover!.summary}
                  </p>
                </div>
              )}

              {/* 顧客状況 */}
              <ItemRow
                emoji="👤"
                label="顧客状況"
                items={handover!.customer_context}
                color="#3050A8"
                bgColor="#EEF4FF"
              />

              {/* 未完了タスク */}
              <ItemRow
                emoji="📋"
                label="未完了タスク"
                items={handover!.open_tasks}
                color="#A07020"
                bgColor="#FFFBF0"
              />

              {/* 推奨アクション */}
              <ItemRow
                emoji="✅"
                label="推奨アクション"
                items={handover!.recommended_actions}
                color="#20906A"
                bgColor="#EDFAF4"
              />

              {/* 注意事項 */}
              <ItemRow
                emoji="⚠️"
                label="注意事項"
                items={handover!.risk_flags}
                color="#C05060"
                bgColor="#FFF0F2"
              />

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

HandoverSectionInner.displayName = 'HandoverSection'
export default HandoverSectionInner

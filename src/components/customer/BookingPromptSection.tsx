'use client'
/**
 * BookingPromptSection.tsx
 * 来店前スタッフ向け AI ブリーフ「Today's AI Brief」。
 * CustomerBottomSheet の顧客ヘッダー直下に配置する。
 *
 * 表示内容:
 *   - 接客ポイント（recommended_topics）
 *   - 提案候補（recommended_proposals）
 *   - 注意事項（risk_flags）
 *   - サマリー（summary）
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { BookingPrompt } from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface BookingPromptSectionProps {
  prompt:     BookingPrompt | null
  loading:    boolean
  collapsed?: boolean
  onToggle?:  () => void
}

// ─── サブセクション ───────────────────────────────────────────────────────────

interface RowItem {
  emoji:  string
  label:  string
  items:  string[]
  color:  string
  bgColor: string
}

function ItemRow({ emoji, label, items, color, bgColor }: RowItem) {
  if (items.length === 0) return null
  return (
    <div style={{
      background:   bgColor,
      borderRadius: '14px',
      padding:      '9px 12px',
    }}>
      <p style={{
        fontSize:      '10px',
        fontWeight:    700,
        color,
        letterSpacing: '0.08em',
        marginBottom:  '5px',
        margin:        '0 0 5px 0',
      }}>
        {emoji} {label}
      </p>
      {items
        .filter(item => item?.trim())
        .map((item, i) => (
          <p key={i} style={{
            fontSize:   '12px',
            color:      '#4A3060',
            lineHeight: 1.6,
            margin:     0,
          }}>
            ・{item}
          </p>
        ))}
    </div>
  )
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

const BookingPromptSectionInner = memo(function BookingPromptSection({
  prompt,
  loading,
  collapsed = false,
  onToggle,
}: BookingPromptSectionProps) {

  const hasData = !loading && prompt !== null
  const isEmpty = !loading && prompt === null

  return (
    <div
      data-testid="booking-prompt-section"
      style={{
        background:   'linear-gradient(135deg, #F5F0FF 0%, #FFF8F5 100%)',
        borderRadius: '22px',
        overflow:     'hidden',
        border:       '1px solid #E8D8F5',
      }}
    >
      {/* ヘッダー */}
      <button
        onClick={onToggle}
        style={{
          width:      '100%',
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding:    '13px 16px',
          background: 'transparent',
          border:     'none',
          cursor:     onToggle ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '15px' }}>✦</span>
          <p style={{
            fontSize:      '12px',
            fontWeight:    700,
            letterSpacing: '0.06em',
            color:         '#6030A8',
            margin:        0,
          }}>
            Today&apos;s AI Brief
          </p>
          {hasData && (
            <span style={{
              fontSize:   '9px',
              padding:    '1px 7px',
              borderRadius: '999px',
              background: 'rgba(96,48,168,0.10)',
              color:      '#6030A8',
              fontWeight: 600,
            }}>
              {Math.round((prompt?.confidence ?? 0) * 100)}%
            </span>
          )}
        </div>
        {onToggle && (
          <span style={{
            fontSize:   '13px',
            color:      '#9060C8',
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
            style={{ fontSize: '11px', color: '#9060C8' }}
          >
            ✦
          </motion.span>
          <p style={{ fontSize: '12px', color: '#9060C8', margin: 0 }}>AI ブリーフを生成中…</p>
        </div>
      )}

      {/* データなし */}
      {isEmpty && (
        <div style={{ padding: '4px 16px 14px' }}>
          <p style={{ fontSize: '11px', color: '#B090D0', margin: 0 }}>
            音声メモを録音すると接客ポイントが自動生成されます
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
              {prompt!.summary && (
                <div style={{
                  background:   '#fff',
                  borderRadius: '14px',
                  padding:      '10px 12px',
                  border:       '1px solid #EDE0FA',
                }}>
                  <p style={{
                    fontSize:   '12px',
                    color:      '#5C4070',
                    lineHeight: 1.7,
                    margin:     0,
                  }}>
                    {prompt!.summary}
                  </p>
                </div>
              )}

              {/* 接客ポイント（recommended_topics） */}
              <ItemRow
                emoji="💬"
                label="接客ポイント"
                items={prompt!.recommended_topics}
                color="#3060C0"
                bgColor="#EEF4FF"
              />

              {/* 提案候補（recommended_proposals） */}
              <ItemRow
                emoji="💡"
                label="提案候補"
                items={prompt!.recommended_proposals}
                color="#20906A"
                bgColor="#EDFAF4"
              />

              {/* 注意事項（risk_flags） */}
              <ItemRow
                emoji="⚠️"
                label="注意事項"
                items={prompt!.risk_flags}
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

BookingPromptSectionInner.displayName = 'BookingPromptSection'
export default BookingPromptSectionInner

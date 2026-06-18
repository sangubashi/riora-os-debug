'use client'
/**
 * ContraindicationSection.tsx
 * ⚠ Contraindications — 施術禁忌・注意事項カード。
 * CustomerBottomSheet の AI Handover 直下に配置する。
 *
 * 表示順: CRITICAL → HIGH → MEDIUM → LOW
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Contraindication, ContraindicationSeverity } from '@/types'
import {
  CONTRAINDICATION_SEVERITY_ORDER,
  CONTRAINDICATION_SEVERITY_LABEL,
  CONTRAINDICATION_SEVERITY_COLOR,
} from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ContraindicationSectionProps {
  items:      Contraindication[]
  loading:    boolean
  collapsed?: boolean
  onToggle?:  () => void
}

// ─── severity バッジ ──────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: ContraindicationSeverity }) {
  const col = CONTRAINDICATION_SEVERITY_COLOR[severity]
  return (
    <span style={{
      fontSize:     '9px',
      fontWeight:   700,
      letterSpacing:'0.08em',
      padding:      '2px 8px',
      borderRadius: '999px',
      background:   col.bg,
      color:        col.text,
      border:       `1px solid ${col.border}`,
      flexShrink:   0,
    }}>
      {CONTRAINDICATION_SEVERITY_LABEL[severity]}
    </span>
  )
}

// ─── 1件の禁忌行 ──────────────────────────────────────────────────────────────

function ContraindicationRow({ item }: { item: Contraindication }) {
  const col = CONTRAINDICATION_SEVERITY_COLOR[item.severity]
  return (
    <div style={{
      background:   col.bg,
      borderRadius: '14px',
      padding:      '10px 12px',
      border:       `1px solid ${col.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <SeverityBadge severity={item.severity} />
        <p style={{ fontSize: '13px', fontWeight: 700, color: col.text, margin: 0 }}>
          {item.title}
        </p>
      </div>
      {item.description && (
        <p style={{ fontSize: '11px', color: '#5C4070', lineHeight: 1.6, margin: '0 0 4px 0' }}>
          {item.description}
        </p>
      )}
      {item.recommendation && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', marginTop: '4px' }}>
          <span style={{ fontSize: '10px', color: col.text, flexShrink: 0, fontWeight: 600 }}>推奨</span>
          <p style={{ fontSize: '11px', color: col.text, fontWeight: 600, margin: 0, lineHeight: 1.5 }}>
            {item.recommendation}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

const ContraindicationSectionInner = memo(function ContraindicationSection({
  items,
  loading,
  collapsed = false,
  onToggle,
}: ContraindicationSectionProps) {

  // severity 順でソート
  const sorted = [...items].sort((a, b) => {
    const oi = CONTRAINDICATION_SEVERITY_ORDER.indexOf(a.severity)
    const oj = CONTRAINDICATION_SEVERITY_ORDER.indexOf(b.severity)
    return oi - oj
  })

  const hasCriticalOrHigh = sorted.some(
    i => i.severity === 'CRITICAL' || i.severity === 'HIGH'
  )

  const hasData = !loading && items.length > 0
  const isEmpty = !loading && items.length === 0

  return (
    <div
      data-testid="contraindication-section"
      style={{
        background:   hasCriticalOrHigh
          ? 'linear-gradient(135deg, #FFF0F2 0%, #FFF8F0 100%)'
          : 'linear-gradient(135deg, #FFFBF0 0%, #F5FFF5 100%)',
        borderRadius: '22px',
        overflow:     'hidden',
        border:       hasCriticalOrHigh ? '1.5px solid #F0B0B8' : '1px solid #E8D890',
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
          <span style={{ fontSize: '15px' }}>⚠️</span>
          <p style={{
            fontSize:      '12px',
            fontWeight:    700,
            letterSpacing: '0.06em',
            color:         hasCriticalOrHigh ? '#C05060' : '#A07020',
            margin:        0,
          }}>
            Contraindications
          </p>
          {hasData && (
            <span style={{
              fontSize:     '9px',
              padding:      '1px 7px',
              borderRadius: '999px',
              background:   hasCriticalOrHigh
                ? 'rgba(192,80,96,0.10)'
                : 'rgba(160,112,32,0.10)',
              color:     hasCriticalOrHigh ? '#C05060' : '#A07020',
              fontWeight: 600,
            }}>
              {sorted.length}件
            </span>
          )}
        </div>
        {onToggle && (
          <span style={{
            fontSize:   '13px',
            color:      hasCriticalOrHigh ? '#C05060' : '#A07020',
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
            style={{ fontSize: '11px', color: '#C05060' }}
          >
            ⚠️
          </motion.span>
          <p style={{ fontSize: '12px', color: '#C05060', margin: 0 }}>禁忌情報を解析中…</p>
        </div>
      )}

      {/* データなし */}
      {isEmpty && (
        <div style={{ padding: '4px 16px 14px' }}>
          <p style={{ fontSize: '11px', color: '#B0A060', margin: 0 }}>
            禁忌・注意事項は検出されていません
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
              {sorted.map(item => (
                <ContraindicationRow key={item.id} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

ContraindicationSectionInner.displayName = 'ContraindicationSection'
export default ContraindicationSectionInner

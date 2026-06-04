'use client'
import { useRef } from 'react'
import { motion } from 'framer-motion'

export type TagFilterKey = 'all' | 'vip' | 'regular' | 'new' | 'risk' | 'followup'

interface TagDef {
  key:    TagFilterKey
  label:  string
  activeBg:   string
  activeDot:  string
}

const TAGS: TagDef[] = [
  { key: 'all',      label: 'すべて',   activeBg: '#F5D6DB', activeDot: '#D98292' },
  { key: 'vip',      label: 'VIP',      activeBg: '#F5E8C8', activeDot: '#D4A96A' },
  { key: 'regular',  label: '常連',     activeBg: '#F5D6DB', activeDot: '#D98292' },
  { key: 'new',      label: '新規',     activeBg: '#D1FAE5', activeDot: '#34D399' },
  { key: 'risk',     label: '要注意',   activeBg: '#FEE2E2', activeDot: '#E84050' },
  { key: 'followup', label: 'フォロー', activeBg: '#FFEDD5', activeDot: '#F5A623' },
]

interface Props {
  active:   TagFilterKey
  onChange: (key: TagFilterKey) => void
  counts?:  Partial<Record<TagFilterKey, number>>
}

export default function TagFilterBar({ active, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-1.5 px-4 py-2.5 no-scrollbar"
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
      } as React.CSSProperties}
    >
      {TAGS.map((tag) => {
        const isActive = active === tag.key
        return (
          <motion.button
            key={tag.key}
            whileTap={{ scale: 0.93 }}
            onClick={() => onChange(tag.key)}
            className="flex-shrink-0 flex items-center gap-1 rounded-full border transition-all duration-150"
            style={{
              padding: '5px 10px',
              fontSize: '11px',
              fontWeight: 500,
              background:   isActive ? tag.activeBg : 'rgba(255,255,255,0.85)',
              border:       isActive ? `1.5px solid ${tag.activeDot}40` : '1px solid #F5E6E8',
              color:        isActive ? '#5B4346' : '#9E8090',
              boxShadow:    isActive ? '0 1px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {isActive && (
              <span
                className="rounded-full flex-shrink-0"
                style={{ width: 5, height: 5, background: tag.activeDot }}
              />
            )}
            {tag.label}
          </motion.button>
        )
      })}
    </div>
  )
}

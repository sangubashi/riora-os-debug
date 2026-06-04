'use client'
import { motion } from 'framer-motion'

const METRICS = [
  { label: 'リピート率',    value: 78,  unit: '%',    color: '#D98292', note: '前月比 +4pt',  progress: true  },
  { label: '3回目離脱率',   value: 23,  unit: '%',    color: '#F5A623', note: '3〜5回目要注意', progress: true  },
  { label: 'VIP転換率',     value: 12,  unit: '%',    color: '#D4A96A', note: '新規→VIP',     progress: true  },
  { label: '無断キャンセル', value: 2.1, unit: '件/週', color: '#E84050', note: '先月比 -0.3件', progress: false },
]

export default function RepeatAnalytics() {
  return (
    <div className="mb-5">
      <div className="flex items-center px-4 mb-2.5">
        <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>REPEAT ANALYTICS</span>
      </div>

      <div
        className="flex gap-3 px-4 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {METRICS.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.55 + i * 0.07, duration: 0.38 }}
            className="flex-shrink-0 w-[130px] rounded-2xl p-3.5"
            style={{
              background: '#FFFFFF',
              border: '1px solid #F5E6E8',
              boxShadow: '0 2px 10px rgba(245,160,181,0.07)',
            }}
          >
            <p className="text-[9px] tracking-wide mb-2 leading-tight" style={{ color: '#B09090' }}>
              {m.label}
            </p>
            <p className="text-[21px] font-light tabular-nums leading-none" style={{ color: m.color }}>
              {m.value}
              <span className="text-[10px] ml-0.5" style={{ color: '#C8B8C0' }}>{m.unit}</span>
            </p>
            {m.progress && (
              <div className="mt-2.5 h-1 rounded-full overflow-hidden" style={{ background: '#F5E6E8' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(m.value, 100)}%` }}
                  transition={{ delay: 0.55 + i * 0.07 + 0.3, duration: 0.7, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: m.color }}
                />
              </div>
            )}
            <p className="mt-1.5 text-[8px]" style={{ color: '#C8B8C0' }}>{m.note}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

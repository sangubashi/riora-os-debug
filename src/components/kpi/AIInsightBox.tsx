'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Lightbulb, Star, ChevronRight } from 'lucide-react'
import type { AiInsight } from '@/store/useKpiStore'

type Props = { insights: AiInsight[] }

const TYPE_CFG = {
  warning: {
    Icon:   AlertTriangle,
    color:  'text-rose-500',
    bg:     '#FFF5F6',
    border: '#FFCDD2',
    label:  'ALERT',
  },
  tip: {
    Icon:   Lightbulb,
    color:  'text-[#C9A055]',
    bg:     '#FFFBF0',
    border: '#F0DCA0',
    label:  'TIP',
  },
  praise: {
    Icon:   Star,
    color:  'text-[#D98292]',
    bg:     '#FFF8FA',
    border: '#F5D6DB',
    label:  'GREAT',
  },
} as const

export default function AIInsightBox({ insights }: Props) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? insights : insights.slice(0, 1)

  return (
    <div className="mx-4 mb-5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>AI INSIGHTS</span>
        {insights.length > 1 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-0.5 text-[10px]"
            style={{ color: '#D98292' }}
          >
            {expanded ? '閉じる' : `+${insights.length - 1}件`}
            <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight size={11} />
            </motion.span>
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {visible.map((insight) => {
            const cfg  = TYPE_CFG[insight.type]
            const Icon = cfg.Icon
            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: 0.22 }}
                className="rounded-2xl p-3"
                style={{
                  background: cfg.bg,
                  border: `1px solid ${cfg.border}`,
                  boxShadow: '0 1px 6px rgba(245,160,181,0.06)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 flex-shrink-0 ${cfg.color}`}>
                    <Icon size={13} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-[9px] ${cfg.color} tracking-widest font-semibold`}>
                      {cfg.label}
                    </span>
                    <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: '#5C4033' }}>
                      {insight.message}
                    </p>
                    {insight.action && (
                      <button className={`mt-1.5 flex items-center gap-0.5 text-[10px] ${cfg.color}`}>
                        {insight.action}
                        <ChevronRight size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

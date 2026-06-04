'use client'
import { motion } from 'framer-motion'

type Color = 'pink' | 'gold' | 'emerald' | 'purple' | 'rose'

const COLOR_MAP: Record<Color, { text: string; bg: string; border: string }> = {
  pink:    { text: '#EA91A6', bg: 'rgba(234,145,166,0.08)', border: 'rgba(234,145,166,0.20)' },
  gold:    { text: '#C49A6B', bg: 'rgba(196,154,107,0.08)', border: 'rgba(196,154,107,0.20)' },
  emerald: { text: '#34D399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.20)'  },
  purple:  { text: '#B09ACE', bg: 'rgba(176,154,206,0.08)', border: 'rgba(176,154,206,0.20)' },
  rose:    { text: '#F87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.20)' },
}

interface Props {
  label:   string
  value:   number | string
  suffix?: string
  color?:  Color
  delay?:  number
}

export default function KpiBadge({ label, value, suffix = '%', color = 'pink', delay = 0 }: Props) {
  const c = COLOR_MAP[color]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.25 }}
      className="flex flex-col items-center justify-center rounded-2xl px-2 py-2.5"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <span
        className="text-[18px] font-light tabular-nums leading-none"
        style={{ color: c.text }}
      >
        {value}{typeof value === 'number' ? suffix : ''}
      </span>
      <span className="text-[9px] mt-1 tracking-wide text-center leading-tight" style={{ color: '#9A7E74' }}>
        {label}
      </span>
    </motion.div>
  )
}

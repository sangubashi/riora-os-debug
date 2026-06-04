'use client'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type Props = {
  value:   number
  suffix?: string
  size?:   'sm' | 'md'
}

export default function TrendBadge({ value, suffix = '%', size = 'sm' }: Props) {
  const isUp     = value > 0
  const isDown   = value < 0
  const color    = isUp ? 'text-emerald-600' : isDown ? 'text-rose-500' : 'text-[#C0B0A8]'
  const bg       = isUp ? 'bg-emerald-50'    : isDown ? 'bg-rose-50'    : 'bg-[#F8F4F2]'
  const Icon     = isUp ? TrendingUp : isDown ? TrendingDown : Minus
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-[12px]'
  const iconSize = size === 'sm' ? 11 : 13

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full ${bg} ${color} ${textSize} font-medium tabular-nums`}
    >
      <Icon size={iconSize} strokeWidth={2.5} />
      {Math.abs(value)}{suffix}
    </motion.span>
  )
}

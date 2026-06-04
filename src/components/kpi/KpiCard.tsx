'use client'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import TrendBadge from './TrendBadge'

type Format = 'currency' | 'percent' | 'number'

interface Props {
  label:           string
  value:           number
  prevDayValue:    number
  prevMonthValue:  number
  format:          Format
  icon:            string
  onTap?:          () => void
  highlight?:      boolean
}

function formatValue(value: number, format: Format): string {
  if (format === 'currency') {
    if (value >= 1_000_000) return `¥${(value / 10000).toFixed(0)}万`
    if (value >= 10_000)    return `¥${(value / 10000).toFixed(1)}万`
    return `¥${value.toLocaleString('ja-JP')}`
  }
  if (format === 'percent') return `${value}%`
  return value.toLocaleString('ja-JP')
}

function AnimatedCounter({ target, format }: { target: number; format: Format }) {
  const [displayed, setDisplayed] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const startTime = Date.now()
    const duration  = 900

    const tick = () => {
      const elapsed  = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(target * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  return <>{formatValue(displayed, format)}</>
}

export default function KpiCard({
  label, value, prevDayValue, prevMonthValue, format, icon, onTap, highlight,
}: Props) {
  const dayDiff   = prevDayValue   > 0 ? +((( value - prevDayValue)   / prevDayValue)   * 100).toFixed(1) : 0
  const monthDiff = prevMonthValue > 0 ? +((( value - prevMonthValue) / prevMonthValue) * 100).toFixed(1) : 0

  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      onClick={onTap}
      className="relative overflow-hidden cursor-pointer rounded-3xl p-4"
      style={{
        background: highlight
          ? 'linear-gradient(135deg, #FFF4F7 0%, #FFFAF4 100%)'
          : '#FFFFFF',
        border: highlight ? '1.5px solid #F2C8D2' : '1px solid #F5E6E8',
        boxShadow: highlight
          ? '0 4px 20px rgba(245,160,181,0.18)'
          : '0 2px 10px rgba(245,160,181,0.08)',
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <span className="text-lg leading-none">{icon}</span>
          <TrendBadge value={dayDiff} />
        </div>

        <div>
          <p
            className="text-[22px] font-light tabular-nums leading-none"
            style={{ color: highlight ? '#D98292' : '#4A2C2A' }}
          >
            <AnimatedCounter target={value} format={format} />
          </p>
          <p className="mt-1.5 text-[10px] tracking-widest" style={{ color: '#B09090' }}>
            {label}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[9px]" style={{ color: '#C8B8B8' }}>前月比</span>
          <TrendBadge value={monthDiff} />
        </div>
      </div>
    </motion.div>
  )
}

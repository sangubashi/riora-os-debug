'use client'
import { motion } from 'framer-motion'

interface Props {
  enabled:   boolean
  onChange:  (v: boolean) => void
  compact?:  boolean
}

export default function SubscriptionToggle({ enabled, onChange, compact = false }: Props) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-2 rounded-full border transition-colors"
      style={
        enabled
          ? {
              background: 'rgba(196,154,107,0.10)',
              borderColor: 'rgba(196,154,107,0.28)',
              padding: compact ? '4px 10px' : '6px 12px',
            }
          : {
              background: '#FFF5F6',
              borderColor: '#F3E3E6',
              padding: compact ? '4px 10px' : '6px 12px',
            }
      }
    >
      {/* Track */}
      <div
        className="relative rounded-full flex-shrink-0"
        style={{
          width:  compact ? 28 : 36,
          height: compact ? 16 : 20,
          background: enabled ? '#C49A6B' : '#E8D5D9',
          transition: 'background 0.2s',
        }}
      >
        <motion.div
          animate={{ x: enabled ? (compact ? 14 : 18) : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-0.5 rounded-full bg-white shadow-sm"
          style={{
            width:  compact ? 12 : 16,
            height: compact ? 12 : 16,
          }}
        />
      </div>
      <span
        className="font-medium whitespace-nowrap"
        style={{
          fontSize: compact ? 10 : 11,
          color: enabled ? '#C49A6B' : '#9A7E74',
        }}
      >
        サブスク対象
      </span>
    </motion.button>
  )
}

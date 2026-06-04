'use client'
import { motion } from 'framer-motion'
import type { WeeklyDatum } from '@/store/useKpiStore'

type Props = { data: WeeklyDatum[] }

export default function WeeklyGraph({ data }: Props) {
  const maxSales  = Math.max(...data.map(d => d.sales))
  const weekTotal = data.reduce((sum, d) => sum + d.sales, 0)
  const todayData = data[data.length - 1]

  return (
    <div className="mx-4 mb-5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>WEEKLY SALES</span>
        <span className="text-[10px]" style={{ color: '#C8B8C0' }}>今週</span>
      </div>

      <div
        className="rounded-3xl p-4"
        style={{
          background: '#FFFFFF',
          border: '1px solid #F5E6E8',
          boxShadow: '0 2px 12px rgba(245,160,181,0.08)',
        }}
      >
        {/* バーグラフ */}
        <div className="flex items-end gap-1.5 h-20 mb-3">
          {data.map((d, i) => {
            const isToday   = d.day === '今日'
            const heightPct = Math.max((d.sales / maxSales) * 100, 4)
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <motion.div
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: i * 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full rounded-t-md"
                  style={{
                    height: `${heightPct}%`,
                    originY: 1,
                    background: isToday
                      ? 'linear-gradient(to top, #D98292, #F2B6C6)'
                      : '#F5E6E8',
                    boxShadow: isToday ? '0 0 12px rgba(217,130,146,0.30)' : 'none',
                  } as React.CSSProperties}
                />
                <span
                  className="text-[9px] font-medium"
                  style={{ color: isToday ? '#D98292' : '#C8B8C0' }}
                >
                  {d.day}
                </span>
              </div>
            )
          })}
        </div>

        {/* サマリー行 */}
        <div className="flex items-end justify-between pt-3" style={{ borderTop: '1px solid #F5E6E8' }}>
          <div>
            <p className="text-[9px] tracking-widest mb-0.5" style={{ color: '#C8B8C0' }}>TODAY</p>
            <p className="text-[17px] font-light tabular-nums" style={{ color: '#4A2C2A' }}>
              ¥{(todayData.sales / 10000).toFixed(1)}万
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] tracking-widest mb-0.5" style={{ color: '#C8B8C0' }}>WEEK TOTAL</p>
            <p className="text-[17px] font-light tabular-nums" style={{ color: '#D98292' }}>
              ¥{(weekTotal / 10000).toFixed(0)}万
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

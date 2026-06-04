'use client'
import { motion } from 'framer-motion'
import type { StaffRankItem } from '@/store/useKpiStore'

type Props = { ranking: StaffRankItem[] }

const RANK_STYLES = [
  { numColor: '#D4A96A', bg: '#FFFAF0', border: '#E8C88A40' },  // 1位 金
  { numColor: '#9E8090', bg: '#FFFFFF', border: '#F5E6E8'   },  // 2位
  { numColor: '#C9A055', bg: '#FFFBF5', border: '#E8C88A30' },  // 3位
]

export default function StaffRanking({ ranking }: Props) {
  return (
    <div className="mx-4 mb-5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>STAFF RANKING</span>
        <span className="text-[10px]" style={{ color: '#C8B8C0' }}>本日</span>
      </div>

      <div className="flex flex-col gap-2">
        {ranking.map((staff, i) => {
          const s = RANK_STYLES[i] ?? RANK_STYLES[1]
          return (
            <motion.div
              key={staff.staffId}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07, duration: 0.35 }}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl"
              style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                boxShadow: '0 1px 6px rgba(245,160,181,0.06)',
              }}
            >
              {/* 順位 */}
              <span className="text-[15px] font-light w-5 text-center flex-shrink-0" style={{ color: s.numColor }}>
                {i + 1}
              </span>

              {/* 情報 */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: '#4A2C2A' }}>{staff.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] tabular-nums" style={{ color: '#9E8090' }}>
                    ¥{(staff.todaySales / 10000).toFixed(1)}万
                  </span>
                  <span className="text-[8px]" style={{ color: '#D8C8C8' }}>·</span>
                  <span className="text-[10px]" style={{ color: '#9E8090' }}>
                    次回{staff.nextReserveCount}件
                  </span>
                  <span className="text-[8px]" style={{ color: '#D8C8C8' }}>·</span>
                  <span className="text-[10px] tabular-nums" style={{ color: '#D98292' }}>
                    AI {staff.aiAdoptRate}%
                  </span>
                </div>
              </div>

              {/* AIスコアバー */}
              <div className="w-14 flex-shrink-0">
                <div className="h-1 rounded-full overflow-hidden" style={{ background: '#F5E6E8' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${staff.aiAdoptRate}%` }}
                    transition={{ delay: i * 0.07 + 0.3, duration: 0.7, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(to right, #D98292, #F2B6C6)' }}
                  />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

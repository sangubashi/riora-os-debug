'use client'
import { motion } from 'framer-motion'

const TIME_SLOTS = ['10', '11', '12', '13', '14', '15', '16', '17']

type SlotStatus = 'empty' | 'busy' | 'full'

const STAFF_DATA: { name: string; slots: SlotStatus[] }[] = [
  { name: '亀山', slots: ['busy', 'full', 'full', 'busy', 'empty', 'busy', 'full', 'busy'] },
  { name: '外舘', slots: ['empty', 'busy', 'full', 'full', 'busy', 'empty', 'busy', 'full'] },
  { name: '中村', slots: ['busy', 'empty', 'busy', 'full', 'full', 'busy', 'empty', 'busy'] },
]

const STATUS_STYLE: Record<SlotStatus, { bg: string; label: string }> = {
  empty: { bg: '#F8F3F5',             label: '空き' },
  busy:  { bg: '#F5D6DB',             label: '混雑' },
  full:  { bg: '#D98292',             label: '満枠' },
}

export default function OccupancyHeatmap() {
  return (
    <div className="mx-4 mb-5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>STAFF OCCUPANCY</span>
        <div className="flex items-center gap-3">
          {(Object.entries(STATUS_STYLE) as [SlotStatus, { bg: string; label: string }][]).map(([, v]) => (
            <div key={v.label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ background: v.bg, border: '1px solid #F0E0E4' }} />
              <span className="text-[8px]" style={{ color: '#C8B8C0' }}>{v.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-3xl p-4"
        style={{
          background: '#FFFFFF',
          border: '1px solid #F5E6E8',
          boxShadow: '0 2px 12px rgba(245,160,181,0.08)',
        }}
      >
        {/* 時間ヘッダー */}
        <div className="flex mb-2" style={{ paddingLeft: '2.5rem' }}>
          {TIME_SLOTS.map(t => (
            <div key={t} className="flex-1 text-center text-[8px]" style={{ color: '#C8B8C0' }}>{t}時</div>
          ))}
        </div>

        {/* スタッフ行 */}
        <div className="flex flex-col gap-1.5">
          {STAFF_DATA.map((staff, si) => (
            <div key={staff.name} className="flex items-center gap-2">
              <span className="w-8 text-right text-[10px] flex-shrink-0" style={{ color: '#9E8090' }}>
                {staff.name}
              </span>
              <div className="flex flex-1 gap-0.5">
                {staff.slots.map((status, ti) => (
                  <motion.div
                    key={ti}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (si * 8 + ti) * 0.018, duration: 0.28 }}
                    className="flex-1 h-7 rounded-lg"
                    style={{ background: STATUS_STYLE[status].bg }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

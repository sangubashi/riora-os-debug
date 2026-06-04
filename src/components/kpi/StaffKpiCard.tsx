'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'

type Stats = {
  sessions:      number   // service_completed = true の件数
  nextReserved:  number
  optionSold:    number
  retailSold:    number
  aiAdopted:     number
  churnFollowed: number
}

const EMPTY: Stats = {
  sessions: 0, nextReserved: 0, optionSold: 0,
  retailSold: 0, aiAdopted: 0, churnFollowed: 0,
}

type Props = {
  staffName: string
  totalAppointments: number   // 本日の予約総数（mock から渡す）
}

function KpiCell({ label, value, sub, accent = false }: {
  label: string; value: number | string; sub?: string; accent?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center px-3 py-3 rounded-2xl ${
        accent ? 'bg-gradient-to-br from-[#D98292]/20 to-[#F2B6C6]/20' : 'bg-white/60'
      }`}
    >
      <span className={`text-2xl font-light tabular-nums ${accent ? 'text-[#D98292]' : 'text-[#5C4033]'}`}>
        {value}
      </span>
      <span className="text-[10px] text-[#C8A58C] mt-0.5 tracking-wide text-center leading-tight">{label}</span>
      {sub && <span className="text-[9px] text-[#D9B8A0] mt-0.5">{sub}</span>}
    </motion.div>
  )
}

export default function StaffKpiCard({ staffName, totalAppointments }: Props) {
  const [stats, setStats]     = useState<Stats>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTodayStats() {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data, error } = await supabase
        .from('staff_logs')
        .select('ai_adopted, next_reserved, option_sold, retail_sold, churn_followed, service_completed')
        .gte('created_at', todayStart.toISOString())

      if (error || !data) { setLoading(false); return }

      const s: Stats = {
        sessions:      data.filter(r => r.service_completed).length,
        nextReserved:  data.filter(r => r.next_reserved).length,
        optionSold:    data.filter(r => r.option_sold).length,
        retailSold:    data.filter(r => r.retail_sold).length,
        aiAdopted:     data.filter(r => r.ai_adopted).length,
        churnFollowed: data.filter(r => r.churn_followed).length,
      }
      setStats(s)
      setLoading(false)
    }

    fetchTodayStats()
    // 30秒ごとにポーリング
    const id = setInterval(fetchTodayStats, 30_000)
    return () => clearInterval(id)
  }, [])

  const nextRate  = totalAppointments > 0
    ? Math.round((stats.nextReserved / totalAppointments) * 100)
    : 0
  const aiRate    = stats.sessions > 0
    ? Math.round((stats.aiAdopted / stats.sessions) * 100)
    : 0

  return (
    <div className="mx-4 mb-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#C8A58C] tracking-widest font-medium">TODAY&apos;S KPI</span>
          {loading && (
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="text-[9px] text-[#C8A58C]"
            >
              読込中...
            </motion.span>
          )}
        </div>
        <span className="text-[10px] text-[#D9B8A0]">{staffName}</span>
      </div>

      {/* KPI グリッド */}
      <div className="grid grid-cols-4 gap-2">
        <KpiCell label="施術完了" value={stats.sessions}      sub={`/ ${totalAppointments}名`} accent />
        <KpiCell label="次回予約" value={stats.nextReserved}  sub={`${nextRate}%`} />
        <KpiCell label="物販"     value={stats.retailSold} />
        <KpiCell label="AI活用率" value={`${aiRate}%`} />
      </div>

      {/* サブ指標 */}
      {(stats.optionSold > 0 || stats.churnFollowed > 0) && (
        <div className="flex gap-2 mt-2">
          {stats.optionSold > 0 && (
            <span className="text-[10px] bg-sky-50 text-sky-600 px-3 py-1 rounded-full">
              💎 オプション {stats.optionSold}件
            </span>
          )}
          {stats.churnFollowed > 0 && (
            <span className="text-[10px] bg-rose-50 text-rose-400 px-3 py-1 rounded-full">
              💌 フォロー {stats.churnFollowed}件
            </span>
          )}
        </div>
      )}
    </div>
  )
}

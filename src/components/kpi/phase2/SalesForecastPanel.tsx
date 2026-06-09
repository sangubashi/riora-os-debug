'use client'
/**
 * SalesForecastPanel.tsx — 売上予測ダッシュボード
 * useKpiStore の current / previousMonth を利用。
 * 追加 DB なし。モックデータで動作確認可能。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useKpiStore } from '@/store/useKpiStore'
import { useCustomerStore } from '@/store/useCustomerStore'
import { calcCustomerPhase } from '@/lib/phase5/customerRiskEngine'

// ─── 定数 ────────────────────────────────────────────────────────────────────

const MONTHLY_TARGET = 1_800_000  // ¥1.8M（月次目標）

// ─── フォーマット ─────────────────────────────────────────────────────────────

function yen(n: number): string {
  return n >= 1_000_000
    ? `¥${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
    ? `¥${Math.round(n / 10_000)}万`
    : `¥${n.toLocaleString()}`
}

// ─── 進捗バー ─────────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100))
  return (
    <div style={{ background: '#F5EEF0', borderRadius: '4px', height: '6px', overflow: 'hidden', marginTop: '6px' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{ height: '100%', borderRadius: '4px', background: color }}
      />
    </div>
  )
}

// ─── KPI カード ───────────────────────────────────────────────────────────────

function ForecastCard({
  title, value, sub, color, target, note,
}: {
  title: string; value: string; sub?: string
  color: string; target?: number; note?: string
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #F5EEF0',
      borderRadius: '16px', padding: '14px 16px',
    }}>
      <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '4px' }}>{title}</p>
      <p style={{ fontSize: '22px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif' }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: '11px', color: '#9F7E6C', marginTop: '2px' }}>{sub}</p>}
      {target !== undefined && (
        <ProgressBar value={parseInt(value.replace(/[¥,万M.]/g, '')) || 0} max={target} color={color} />
      )}
      {note && (
        <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '6px' }}>{note}</p>
      )}
    </div>
  )
}

// ─── 不足原因タグ ─────────────────────────────────────────────────────────────

function CauseTag({ label, severity }: { label: string; severity: 'warn' | 'info' }) {
  const color = severity === 'warn' ? '#EF476F' : '#F56E8B'
  return (
    <span style={{
      fontSize: '10px', padding: '3px 10px', borderRadius: '999px',
      background: color + '18', color, border: `1px solid ${color}44`,
      display: 'inline-block', margin: '3px 3px 0 0',
    }}>
      {label}
    </span>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function SalesForecastPanel() {
  const { current, previousMonth } = useKpiStore()
  const customers = useCustomerStore(s => s.customers)

  const {
    todayLanded, monthLanded, nextMonthForecast,
    shortage, targetRate, causes,
  } = useMemo(() => {
    const today      = new Date()
    const dayOfMonth = today.getDate()
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const remaining  = daysInMonth - dayOfMonth

    // 今月着地予測
    const dailyAvg   = current.monthlySales > 0
      ? current.monthlySales / dayOfMonth
      : current.todaySales
    const monthLanded = Math.round(current.monthlySales + dailyAvg * remaining)

    // 今日の売上（日次着地）
    const todayLanded = current.todaySales

    // 来月予測: VIP/リピーターの継続来店 + 新規見込み
    const vipCount = customers.filter(c => calcCustomerPhase({
      visits: c.visitCount, totalSales: c.totalSpent,
      vipRank: c.isVip ? 3 : 0, churnRisk: c.churnRisk,
      daysSinceLastVisit: c.lastVisit, recommendedCycleDays: 30,
    }) === 'vip').length

    const repeatCount = customers.filter(c => {
      const p = calcCustomerPhase({
        visits: c.visitCount, totalSales: c.totalSpent,
        vipRank: c.isVip ? 3 : 0, churnRisk: c.churnRisk,
        daysSinceLastVisit: c.lastVisit, recommendedCycleDays: 30,
      })
      return p === 'repeat' || p === 'growing'
    }).length

    const avgVipSpend    = vipCount > 0
      ? customers.filter(c => c.isVip).reduce((s, c) => s + c.totalSpent / Math.max(c.visitCount, 1), 0) / vipCount
      : 30_000
    const avgRepeatSpend = 15_000

    const nextMonthForecast = Math.round(
      vipCount * avgVipSpend
      + repeatCount * avgRepeatSpend * 0.7
      + previousMonth.monthlySales * 0.05  // 新規見込み5%
    )

    // 不足額
    const shortage  = Math.max(0, MONTHLY_TARGET - monthLanded)
    const targetRate = Math.round((monthLanded / MONTHLY_TARGET) * 100)

    // 不足原因分析
    const causes: { label: string; severity: 'warn' | 'info' }[] = []
    if (current.nextReserveRate < 70) causes.push({ label: `次回予約率 ${current.nextReserveRate}%（目標70%）`, severity: 'warn' })
    if (current.repeatRate < 75)      causes.push({ label: `リピート率 ${current.repeatRate}%（目標75%）`, severity: 'warn' })
    if (current.lineResponseRate < 60) causes.push({ label: `LINE返信率 ${current.lineResponseRate}%（低下中）`, severity: 'info' })
    if (vipCount === 0)               causes.push({ label: 'VIP顧客の来店が少ない', severity: 'warn' })
    if (causes.length === 0)          causes.push({ label: '目標達成ペースです', severity: 'info' })

    return { todayLanded, monthLanded, nextMonthForecast, shortage, targetRate, causes }
  }, [current, previousMonth, customers])

  return (
    <div style={{ padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* 今月 */}
      <p style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 600, marginTop: '8px', letterSpacing: '0.05em' }}>
        今月
      </p>

      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <ForecastCard
            title="本日売上"
            value={yen(todayLanded)}
            color="#5C4033"
          />
        </div>
        <div style={{ flex: 1 }}>
          <ForecastCard
            title="今月累計"
            value={yen(current.monthlySales)}
            sub={`目標比 ${targetRate}%`}
            color={targetRate >= 100 ? '#52B788' : targetRate >= 80 ? '#FFD166' : '#EF476F'}
          />
        </div>
      </div>

      {/* 今月着地予測 */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0',
        borderRadius: '16px', padding: '14px 16px',
      }}>
        <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '4px' }}>今月着地予測</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <p style={{
            fontSize: '26px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
            color: monthLanded >= MONTHLY_TARGET ? '#52B788' : '#F56E8B',
          }}>
            {yen(monthLanded)}
          </p>
          <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '4px' }}>
            目標 {yen(MONTHLY_TARGET)}
          </p>
        </div>
        <ProgressBar
          value={monthLanded} max={MONTHLY_TARGET}
          color={monthLanded >= MONTHLY_TARGET ? '#52B788' : '#F56E8B'}
        />
        {shortage > 0 && (
          <p style={{ fontSize: '11px', color: '#EF476F', marginTop: '8px', fontWeight: 600 }}>
            不足: {yen(shortage)}
          </p>
        )}
        {shortage === 0 && (
          <p style={{ fontSize: '11px', color: '#52B788', marginTop: '8px', fontWeight: 600 }}>
            ✓ 目標達成予測
          </p>
        )}
      </div>

      {/* 不足原因 */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0',
        borderRadius: '16px', padding: '14px 16px',
      }}>
        <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600, marginBottom: '8px' }}>
          不足原因分析
        </p>
        <div>
          {causes.map(c => <CauseTag key={c.label} label={c.label} severity={c.severity} />)}
        </div>
      </div>

      {/* 来月予測 */}
      <p style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 600, marginTop: '4px', letterSpacing: '0.05em' }}>
        来月予測
      </p>

      <ForecastCard
        title="来月売上予測"
        value={yen(nextMonthForecast)}
        sub={`VIP継続 + リピーター継続 + 新規見込みの合計`}
        color="#4878A8"
        note="※ 現在の顧客データと来店頻度から算出"
      />

      {/* 先月比 */}
      <div style={{
        background: '#fff', border: '1px solid #F5EEF0',
        borderRadius: '16px', padding: '14px 16px',
      }}>
        <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600, marginBottom: '10px' }}>
          先月比
        </p>
        {[
          { label: '月次売上',    curr: current.monthlySales,       prev: previousMonth.monthlySales,       fmt: (v: number) => yen(v) },
          { label: '次回予約率',  curr: current.nextReserveRate,     prev: previousMonth.nextReserveRate,     fmt: (v: number) => `${v}%` },
          { label: 'リピート率',  curr: current.repeatRate,          prev: previousMonth.repeatRate,          fmt: (v: number) => `${v}%` },
          { label: 'LINE返信率',  curr: current.lineResponseRate,    prev: previousMonth.lineResponseRate,    fmt: (v: number) => `${v}%` },
        ].map(({ label, curr, prev, fmt }) => {
          const diff  = curr - prev
          const color = diff > 0 ? '#52B788' : diff < 0 ? '#EF476F' : '#C8A8B0'
          const sign  = diff > 0 ? '+' : ''
          return (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              paddingBottom: '8px', borderBottom: '1px solid #F5EEF0',
              marginBottom: '8px',
            }}>
              <span style={{ fontSize: '11px', color: '#9F7E6C' }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                  {fmt(curr)}
                </span>
                <span style={{ fontSize: '10px', color, fontWeight: 600 }}>
                  {sign}{typeof diff === 'number' && label.includes('率') ? `${diff}%` : diff !== 0 ? yen(Math.abs(diff)) : '±0'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

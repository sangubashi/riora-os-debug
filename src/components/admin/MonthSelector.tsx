'use client'
/**
 * MonthSelector.tsx — 管理ダッシュボード共通「表示月」セレクター
 *
 * 今月 / 先月 / 任意月(input[type=month])を切り替えるコンポーネント。
 * useMonthStore を更新し、URL パラム ?month=YYYY-MM も同期する。
 */
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { useMonthStore } from '@/store/useMonthStore'

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function prevYearMonth(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export default function MonthSelector() {
  const { selectedMonth, setSelectedMonth } = useMonthStore()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const thisMonth = currentYearMonth()
  const lastMonth = prevYearMonth()

  function handleChange(m: string) {
    if (!m || !/^\d{4}-\d{2}$/.test(m)) return
    setSelectedMonth(m)
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', m)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const isCustom = selectedMonth !== thisMonth && selectedMonth !== lastMonth

  const btnBase: React.CSSProperties = {
    padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
    cursor: 'pointer', transition: 'all 0.1s',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <CalendarDays size={13} color="#C8A8B0" />
      <button
        style={{
          ...btnBase,
          border: `1px solid ${selectedMonth === thisMonth ? '#D98292' : '#F5EEF0'}`,
          background: selectedMonth === thisMonth ? '#FDEEF1' : '#fff',
          color: selectedMonth === thisMonth ? '#D98292' : '#9F7E6C',
        }}
        onClick={() => handleChange(thisMonth)}
      >
        今月
      </button>
      <button
        style={{
          ...btnBase,
          border: `1px solid ${selectedMonth === lastMonth ? '#D98292' : '#F5EEF0'}`,
          background: selectedMonth === lastMonth ? '#FDEEF1' : '#fff',
          color: selectedMonth === lastMonth ? '#D98292' : '#9F7E6C',
        }}
        onClick={() => handleChange(lastMonth)}
      >
        先月
      </button>
      <input
        type="month"
        value={selectedMonth}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          padding: '3px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
          border: `1px solid ${isCustom ? '#D98292' : '#F5EEF0'}`,
          background: isCustom ? '#FDEEF1' : '#fff',
          color: '#5C4033', outline: 'none', cursor: 'pointer',
        }}
      />
    </div>
  )
}

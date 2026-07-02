'use client'
/**
 * StaffAnalyticsScreen.tsx — スタッフ分析(画面④・MD-4・管理者専用)
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面④
 * 「3名カード(五十音順・順位/合計/平均比較なし)」「売上単体表示を型で禁止」
 *
 * 制約(ユーザー指示・2026-06-23): ランキング禁止・順位表示禁止・売上単体比較禁止・
 * 五十音順表示。本コンポーネントはAPIが返した配列順(五十音順)をそのまま描画するのみで、
 * クライアント側で並び替え・順位番号・スタッフ間の比較強調は一切行わない。
 */
import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, User } from 'lucide-react'
import { useStaffAnalyticsStore } from '@/store/useStaffAnalyticsStore'
import { useMonthStore } from '@/store/useMonthStore'
import MonthSelector from '../MonthSelector'
import { DEMO_STORE_ID } from '@/lib/constants'

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function formatGrowth(rate: number | null): { text: string; color: string } {
  if (rate === null) return { text: '—', color: '#9F7E6C' }
  const pct = Math.round(rate * 100)
  if (pct > 0) return { text: `+${pct}%`, color: '#3C9D5C' }
  if (pct < 0) return { text: `${pct}%`, color: '#D14F4F' }
  return { text: '±0%', color: '#9F7E6C' }
}

function Metric({ label, value, color = '#5C4033' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: '90px', background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px', border: '1px solid #F5EEF0' }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
      <p style={{ fontSize: '15px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif', lineHeight: 1.1 }}>{value}</p>
    </div>
  )
}

function StaffCard({ row, monthLabel }: { row: { staffName: string; monthlySales: number; nominationRate: number | null; repeatRate: number | null; ltv: number | null; growthRate: number | null }; monthLabel: string }) {
  const growth = formatGrowth(row.growthRate)
  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <User size={15} color="#D98292" />
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{row.staffName} さん</span>
      </div>

      {/* 売上は必ず指名率・リピート率と同居して表示する(v2.0「売上単体表示を型で禁止」) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <Metric label={`売上(${monthLabel})`} value={formatYen(row.monthlySales)} />
        <Metric label="指名率" value={formatPercent(row.nominationRate)} />
        <Metric label="リピート率" value={formatPercent(row.repeatRate)} />
        <Metric label="LTV" value={row.ltv === null ? '—' : formatYen(Math.round(row.ltv))} />
        <Metric label="成長率(前月比)" value={growth.text} color={growth.color} />
      </div>
    </div>
  )
}

function StaffAnalyticsContent() {
  const { staffAnalytics, isLoading, error, fetchStaffAnalytics } = useStaffAnalyticsStore()
  const { selectedMonth, setSelectedMonth } = useMonthStore()
  const searchParams = useSearchParams()

  // URL の ?month= を読んでストアに反映(リロード復元)
  useEffect(() => {
    const urlMonth = searchParams.get('month')
    if (urlMonth && /^\d{4}-\d{2}$/.test(urlMonth)) {
      setSelectedMonth(urlMonth)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchStaffAnalytics(DEMO_STORE_ID, selectedMonth)
  }, [fetchStaffAnalytics, selectedMonth])

  const currentYM = new Date().toISOString().slice(0, 7)
  const isCurrentMonth = selectedMonth === currentYM
  const monthLabel = isCurrentMonth ? '今月' : `${Number(selectedMonth.slice(5, 7))}月`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          画面④ MD-4
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>スタッフ分析</h1>
          <MonthSelector />
        </div>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          五十音順に表示しています。ランキング・順位はありません。
        </p>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>
          スタッフ分析の取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && !error && staffAnalytics.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          スタッフが登録されていません
        </div>
      )}

      {!isLoading && staffAnalytics.map((row) => (
        <StaffCard key={row.staffId} row={row} monthLabel={monthLabel} />
      ))}
    </div>
  )
}

export default function StaffAnalyticsScreen() {
  return (
    <Suspense>
      <StaffAnalyticsContent />
    </Suspense>
  )
}

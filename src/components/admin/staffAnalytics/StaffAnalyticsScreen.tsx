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
 *
 * PHASE ADMIN-UX-1(2026-07-27・UI調整のみ): 前月比(growthRate)を矢印+色付きバッジで
 * カード上部に強調表示、指標をレスポンシブグリッド化、カード幅を1920/1366/タブレットで
 * 自然に折り返すよう調整した。growthRateの計算・APIは変更していない。
 */
import { useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, User, TrendingUp, TrendingDown, Minus } from 'lucide-react'
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

/** 前月比バッジ用(矢印+色+テキスト)。rate=nullは「前月/当月データなし」で赤字扱いにしない(中立色)。 */
function formatGrowth(rate: number | null): { text: string; color: string; bg: string; Icon: typeof TrendingUp } {
  if (rate === null) return { text: 'データなし', color: '#9F7E6C', bg: 'rgba(159,126,108,0.08)', Icon: Minus }
  const pct = Math.round(rate * 100)
  if (pct > 0) return { text: `+${pct}%`, color: '#3C9D5C', bg: 'rgba(60,157,92,0.10)', Icon: TrendingUp }
  if (pct < 0) return { text: `${pct}%`, color: '#D14F4F', bg: 'rgba(209,79,79,0.10)', Icon: TrendingDown }
  return { text: '±0%', color: '#9F7E6C', bg: 'rgba(159,126,108,0.08)', Icon: Minus }
}

/** 指標グリッド。auto-fitで1920px〜タブレット幅まで列数が自然に変わる(PHASE ADMIN-UX-1)。 */
function MetricGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
      {children}
    </div>
  )
}

function Metric({ label, value, color = '#5C4033', hint }: { label: string; value: string; color?: string; hint?: string }) {
  const isEmpty = value === '—'
  return (
    <div style={{ background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px', border: '1px solid #F5EEF0', minHeight: '66px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
      <p style={{ fontSize: '18px', fontWeight: 700, color: isEmpty ? '#C8A8B0' : color, fontFamily: 'Inter, sans-serif', lineHeight: 1.1 }}>{value}</p>
      {isEmpty && hint && (
        <p style={{ fontSize: '9px', color: '#C8A8B0', marginTop: '3px', lineHeight: 1.3 }}>{hint}</p>
      )}
    </div>
  )
}

function GrowthBadge({ growthRate }: { growthRate: number | null }) {
  const growth = formatGrowth(growthRate)
  const { Icon } = growth
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: growth.bg, color: growth.color,
        borderRadius: '999px', padding: '4px 10px', fontSize: '12px', fontWeight: 700,
      }}
    >
      <Icon size={13} strokeWidth={2.5} />
      {growth.text}
      <span style={{ fontSize: '9px', fontWeight: 500, opacity: 0.75 }}>前月比</span>
    </div>
  )
}

function StaffCard({ row, monthLabel }: { row: { staffName: string; monthlySales: number; visitCount: number; avgSpend: number | null; nominationRate: number | null; repeatRate: number | null; ltv: number | null; growthRate: number | null }; monthLabel: string }) {
  // 当月の担当来店が1件も無いスタッフ(例: 久保田)は、指標が軒並みnullになり
  // 「—」だらけで壊れて見えるため、専用の空状態メッセージに置き換える(PHASE MD-2要件5)。
  if (row.visitCount === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '168px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={15} color="#D98292" />
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{row.staffName} さん</span>
        </div>
        <p style={{ fontSize: '12px', color: '#C8A8B0' }}>担当来店データがありません</p>
      </div>
    )
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '168px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={15} color="#D98292" />
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{row.staffName} さん</span>
        </div>
        <GrowthBadge growthRate={row.growthRate} />
      </div>

      {/* 売上は必ず指名率・リピート率と同居して表示する(v2.0「売上単体表示を型で禁止」) */}
      <MetricGrid>
        <Metric label={`売上(${monthLabel})`} value={formatYen(row.monthlySales)} />
        <Metric label="来店人数" value={`${row.visitCount}人`} />
        <Metric label="客単価" value={row.avgSpend === null ? '—' : formatYen(row.avgSpend)} />
        <Metric label="指名率" value={formatPercent(row.nominationRate)} />
        <Metric label="リピート率" value={formatPercent(row.repeatRate)} />
        <Metric label="LTV" value={row.ltv === null ? '—' : formatYen(Math.round(row.ltv))} hint="データ不足のため未計測" />
      </MetricGrid>
    </div>
  )
}

function StaffAnalyticsContent() {
  const { staffAnalytics, isLoading, error, autoSelectedLatestMonth, fetchStaffAnalytics } = useStaffAnalyticsStore()
  const { selectedMonth, setSelectedMonth } = useMonthStore()
  const searchParams = useSearchParams()
  // 直近にfetch済みの月を覚えておき、自動判定直後の二重fetchを防ぐ(PHASE MD-2)。
  const lastFetchedMonthRef = useRef<string | null>(null)

  // 初回マウント時: URLの?month=があればそれを最優先(要件2)。無ければmonthを
  // 省略してfetchし、APIが自動選択した最新データ月をselectedMonthへ反映する(要件1)。
  useEffect(() => {
    const urlMonth = searchParams.get('month')
    if (urlMonth && /^\d{4}-\d{2}$/.test(urlMonth)) {
      setSelectedMonth(urlMonth)
      return
    }
    fetchStaffAnalytics(DEMO_STORE_ID).then(() => {
      const resolved = useStaffAnalyticsStore.getState().resolvedMonth
      if (resolved) {
        lastFetchedMonthRef.current = resolved
        setSelectedMonth(resolved)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // selectedMonthの変化(月セレクタ操作・URL反映)に追従して再取得。
  // 初回自動判定で既に取得済みの月と同一なら再取得しない(二重fetch防止)。
  useEffect(() => {
    if (lastFetchedMonthRef.current === selectedMonth) return
    lastFetchedMonthRef.current = selectedMonth
    fetchStaffAnalytics(DEMO_STORE_ID, selectedMonth)
  }, [fetchStaffAnalytics, selectedMonth])

  const currentYM = new Date().toISOString().slice(0, 7)
  const isCurrentMonth = selectedMonth === currentYM
  const monthLabel = isCurrentMonth ? '今月' : `${Number(selectedMonth.slice(5, 7))}月`

  return (
    <div className="p-4 sm:p-5 lg:p-8" style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
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
        {autoSelectedLatestMonth && (
          <p style={{ fontSize: '11px', color: '#9F7E6C', marginTop: '4px' }}>
            最新データ月（{selectedMonth}）を表示しています
          </p>
        )}
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

      {!isLoading && staffAnalytics.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {staffAnalytics.map((row) => (
            <StaffCard key={row.staffId} row={row} monthLabel={monthLabel} />
          ))}
        </div>
      )}
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

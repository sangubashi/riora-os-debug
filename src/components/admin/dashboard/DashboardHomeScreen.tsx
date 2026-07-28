'use client'
/**
 * DashboardHomeScreen.tsx — 経営TOP(画面①・MD-1・owner専用)
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面①
 *
 * 集計はnightly-dashboard(brain_dashboard_daily)生成済みの値を読むだけ。本日売上のみ
 * 当日visitsから軽量集計(API側で算出)。KPIは4枠固定・今日の一手は一行行動指示のみ
 * (気づき列挙・グラフは置かない・LINE送信などの現場操作は置かない)。
 *
 * スタッフランキングはv2.0画面④(MD-4・売上単体表示禁止)の別契約のため本画面には含めない。
 *
 * PHASE ADMIN-UX-1(2026-07-27・UI調整のみ): 情報の優先順位を「今日売上→今月売上→
 * 利益見込み→損益分岐点→今週予約状況→今日の一手」の順に並べ替え、人件費率の強調・
 * 空状態の説明文・レスポンシブグリッド化・チャート/AI一手の可読性を改善した。
 * API・計算式・データ取得ロジックは一切変更していない(表示順序とスタイルのみ)。
 */
import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { TrendingUp, CalendarCheck, CalendarDays, MessageCircleHeart, AlertTriangle, AlertCircle, Info, UploadCloud, Loader2, Users, Target, Settings, X, LineChart, ShieldAlert, Sparkles, ListChecks } from 'lucide-react'
import { useDashboardTopStore, type TodayAction, type WeeklyReservations, type WeeklyReservationDayCount } from '@/store/useDashboardTopStore'
import { useBusinessSettingsStore } from '@/store/useBusinessSettingsStore'
import { useMonthStore } from '@/store/useMonthStore'
import MonthSelector from '../MonthSelector'
import { DEMO_STORE_ID } from '@/lib/constants'
import { computeRiskAlerts, computeGoodNews, computeWeeklyFocus, type RiskAlert, type GoodNewsItem, type WeeklyFocusItem } from '@/lib/dashboard/computeDashboardHighlights'

const SEVERITY_STYLE: Record<TodayAction['severity'], { color: string; bg: string; Icon: typeof AlertTriangle; label: string }> = {
  critical: { color: '#D14F4F', bg: 'rgba(209,79,79,0.08)', Icon: AlertCircle, label: '優先度: 高' },
  warning: { color: '#D98292', bg: 'rgba(217,130,146,0.08)', Icon: AlertTriangle, label: '優先度: 中' },
  info: { color: '#7C9CC4', bg: 'rgba(124,156,196,0.08)', Icon: Info, label: '優先度: 低' },
}

const ACTION_TYPE_LABEL: Record<TodayAction['actionType'], string> = {
  contact_customer: '顧客へ連絡',
  send_line: 'LINE案内',
  review_staff: 'スタッフと確認',
  upsell_campaign: 'アップセル提案',
}

const DAY_LABEL_JA: Record<WeeklyReservationDayCount['dayOfWeek'], string> = {
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日',
}

function formatJstTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

/**
 * 経営TOPのサマリー金額用（DASHBOARD_CURRENCY_IMPLEMENT_2）。
 * 金額の大小に関わらず万円単位（整数丸め）で統一表示する。
 * K表記（英語圏の千単位表記）は日本の商習慣に馴染まないため廃止。
 */
function formatYen(amount: number): string {
  const man = Math.round(amount / 10000)
  return `${man.toLocaleString('ja-JP')}万円`
}

/**
 * 客単価専用（DASHBOARD_CURRENCY_IMPLEMENT_1・変更禁止対象）。
 * 万円表示への丸めは行わず、常にフル桁で表示する。
 */
function formatYenFull(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** 日付ラベル(月/日)。売上推移チャートのX軸ラベル用(既存データのsnapshotDateを整形するのみ)。 */
function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/**
 * 人件費率（PHASE MD-1）に含める fixedCosts 内訳キー。
 * ユーザー承認済みの範囲（役員報酬・外注費・固定給・社会保険料）のみを合算する。
 * DashboardAggregator/APIの計算式は変更せず、既存の business_settings.fixedCosts を
 * フロント側で読み替えるだけ。
 */
const LABOR_COST_KEYS = [
  'officer_suzuki',
  'officer_kishi',
  'outsource_kubota',
  'salary_kameyama',
  'salary_todate',
  'social_insurance_estimate',
  'social_insurance_actual',
] as const

/**
 * 広告費として扱うfixedCostsキー(PHASE ADMIN-COMPLETE-1)。BusinessSettingsForm.tsxの
 * FIXED_COST_FIELDSのうち広告費に相当するもの(ad_hotpepper)のみ。API変更・計算式変更は
 * 行わず、既存business_settings.fixedCostsをフロント側で読み替えるだけ(人件費内訳と同じ方式)。
 */
const AD_COST_KEYS = ['ad_hotpepper'] as const

function sumCostKeys(fixedCosts: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!fixedCosts) return null
  let total = 0
  let hasValue = false
  for (const key of keys) {
    const v = fixedCosts[key]
    if (typeof v === 'number' && Number.isFinite(v)) { total += v; hasValue = true }
  }
  return hasValue ? total : null
}

function sumLaborCosts(fixedCosts: Record<string, unknown> | null): number | null {
  return sumCostKeys(fixedCosts, LABOR_COST_KEYS)
}

/**
 * 人件費率の表示色分け(PHASE ADMIN-UX-1・表示のみ)。一般的なサロン業態の目安として
 * 35%以下=健全/35〜50%=注意/50%超=高い、の3段階で色を変えるだけで、数値自体・
 * 計算式は変更しない(既存のlaborCostRate計算をそのまま使う)。
 */
function laborCostColor(rate: number | null): string {
  if (rate === null) return '#9F7E6C'
  if (rate <= 35) return '#3C9D5C'
  if (rate <= 50) return '#D98F3C'
  return '#D14F4F'
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 今日・翌日の曜日キー(JST基準)。「今週の予約状況」の強調表示用の純粋な日付計算のみで、新しいデータ取得は行わない。 */
function jstDayOfWeek(offsetDays: number): WeeklyReservationDayCount['dayOfWeek'] {
  const now = new Date()
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  jst.setDate(jst.getDate() + offsetDays)
  const map: WeeklyReservationDayCount['dayOfWeek'][] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return map[jst.getDay()]
}

/** PHASE ADMIN-COMPLETE-1: 余白を広く・角丸を大きく・影を柔らかくして「毎日見る画面」としての読みやすさを上げる(データ・ロジックは変更しない、見た目のみ)。 */
function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '20px', padding: '20px 22px', boxShadow: '0 1px 3px rgba(92,64,51,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        {icon}
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', letterSpacing: '0.01em' }}>{title}</p>
      </div>
      {children}
    </div>
  )
}

/** KPI/指標の均一グリッド。auto-fitで1920px〜タブレット幅まで列数が自然に変わる(PHASE ADMIN-UX-1)。 */
function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
      {children}
    </div>
  )
}

function Stat({ label, value, color = '#5C4033', hint }: { label: string; value: string; color?: string; hint?: string }) {
  const isEmpty = value === '—'
  return (
    <div style={{ background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px', border: '1px solid #F5EEF0', minHeight: '68px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
      <p style={{ fontSize: '18px', fontWeight: 700, color: isEmpty ? '#C8A8B0' : color, fontFamily: 'Inter, sans-serif', lineHeight: 1.1 }}>{value}</p>
      {isEmpty && hint && (
        <p style={{ fontSize: '9px', color: '#C8A8B0', marginTop: '3px', lineHeight: 1.3 }}>{hint}</p>
      )}
    </div>
  )
}

/**
 * 利益見込みカード内の費用内訳ミニ表示(PHASE ADMIN-COMPLETE-1)。
 * 固定費・人件費・広告費の合計を小さく併記するだけ(新しい計算式・新しいAPIは追加しない。
 * 既存business_settings.fixedCostsをフロント側で読み替えた値をそのまま表示する)。
 */
function CostBreakdownMini({ fixedCostTotal, laborCostTotal, adCostTotal }: { fixedCostTotal: number | null; laborCostTotal: number | null; adCostTotal: number | null }) {
  if (fixedCostTotal === null && laborCostTotal === null && adCostTotal === null) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #F5EEF0' }}>
      <span style={{ fontSize: '10px', color: '#9F7E6C' }}>固定費 <strong style={{ color: '#5C4033' }}>{fixedCostTotal === null ? '—' : formatYen(fixedCostTotal)}</strong></span>
      <span style={{ fontSize: '10px', color: '#9F7E6C' }}>人件費 <strong style={{ color: '#5C4033' }}>{laborCostTotal === null ? '—' : formatYen(laborCostTotal)}</strong></span>
      <span style={{ fontSize: '10px', color: '#9F7E6C' }}>広告費 <strong style={{ color: '#5C4033' }}>{adCostTotal === null ? '—' : formatYen(adCostTotal)}</strong></span>
    </div>
  )
}

/** 「本日の売上」ヒーロー表示(PHASE ADMIN-UX-1)。最初の30秒で目に入る最優先情報。既存kpi4.todaySalesをそのまま表示するだけ。 */
function TodaySalesHero({ amount }: { amount: number }) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #FDEEF1, #FFF8F7)',
        border: '1px solid #F5D9DF',
        borderRadius: '22px',
        padding: '22px 24px',
        boxShadow: '0 1px 3px rgba(92,64,51,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <TrendingUp size={18} color="#D98292" />
        </div>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#9F7E6C' }}>本日の売上</p>
      </div>
      <p style={{ fontSize: '30px', fontWeight: 800, color: '#5C4033', fontFamily: 'Inter, sans-serif', lineHeight: 1 }}>
        {formatYen(amount)}
      </p>
    </div>
  )
}

function SalesTrendChart({ points }: { points: { snapshotDate: string; monthlySales: number; forecastSales: number }[] }) {
  if (points.length === 0) {
    return <p style={{ fontSize: '12px', color: '#C8A8B0', padding: '12px 0' }}>当月のスナップショットはまだありません</p>
  }
  const max = Math.max(...points.map((p) => Math.max(p.monthlySales, p.forecastSales)), 1)
  const first = points[0]
  const last = points[points.length - 1]
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
        <span style={{ fontSize: '10px', color: '#C8A8B0' }}>最大 {formatYen(max)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '96px', padding: '6px 2px 4px', borderBottom: '1px solid #F5EEF0' }}>
        {points.map((p) => (
          <div
            key={p.snapshotDate}
            title={`${p.snapshotDate}: ${formatYen(p.monthlySales)}`}
            style={{
              flex: 1,
              height: `${Math.max((p.monthlySales / max) * 100, 2)}%`,
              background: 'linear-gradient(180deg, #F56E8B, #F0487A)',
              borderRadius: '4px 4px 0 0',
              minWidth: '4px',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
        <span style={{ fontSize: '10px', color: '#C8A8B0' }}>{formatShortDate(first.snapshotDate)}</span>
        <span style={{ fontSize: '10px', color: '#C8A8B0' }}>{formatShortDate(last.snapshotDate)}</span>
      </div>
    </div>
  )
}

/**
 * 「今週の予約状況」詳細モーダル(曜日別予約一覧・担当スタッフ・予約時間・予約メニュー)。
 * 予約率・稼働率・空き枠率(営業時間/シフトを分母とする計算)は表示しない。
 */
function WeeklyReservationsDetailModal({ data, onClose }: { data: WeeklyReservations; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[70] px-4"
      style={{ background: 'rgba(92,64,51,0.35)' }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-[22px] p-5"
        style={{ maxWidth: '420px', maxHeight: '80vh', overflowY: 'auto', background: '#fff' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <p className="text-[15px] font-semibold" style={{ color: '#5C4033' }}>今週の予約状況(詳細)</p>
          <button onClick={onClose} aria-label="閉じる" style={{ color: '#9F7E6C' }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: '11px', color: '#C8A8B0', marginBottom: '12px' }}>{data.weekStart} 〜 {data.weekEnd}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {data.dayOfWeekCounts.map(({ dayOfWeek }) => {
            const items = data.reservations.filter((r) => r.dayOfWeek === dayOfWeek)
            return (
              <div key={dayOfWeek}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#D98292', marginBottom: '6px' }}>
                  {DAY_LABEL_JA[dayOfWeek]}曜日 — {items.length}件
                </p>
                {items.length === 0 ? (
                  <p style={{ fontSize: '11px', color: '#C8A8B0' }}>予約はありません</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {items.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                          background: '#FFF8F7', border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>{formatJstTime(r.scheduledAt)}〜 {r.menu}</p>
                          <p style={{ fontSize: '11px', color: '#9F7E6C' }}>担当: {r.staffName ?? '不明'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * 「今週の予約状況」カード(実データのみ。予約率・稼働率・空き枠率は算出しない)。
 * PHASE ADMIN-UX-1: 今日・明日・週末の件数を上部に強調表示し、曜日別リストでも
 * 今日/明日の行を目立たせる(新しいデータ取得は行わず、既存dayOfWeekCountsを
 * クライアント側で日付照合するだけ)。
 */
function WeeklyReservationsCard({ data }: { data: WeeklyReservations }) {
  const [showDetail, setShowDetail] = useState(false)
  const maxCount = Math.max(...data.dayOfWeekCounts.map((d) => d.count), 1)
  const todayKey = jstDayOfWeek(0)
  const tomorrowKey = jstDayOfWeek(1)
  const countOf = (key: WeeklyReservationDayCount['dayOfWeek']) => data.dayOfWeekCounts.find((d) => d.dayOfWeek === key)?.count ?? 0
  const weekendCount = countOf('sat') + countOf('sun')

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '20px', padding: '20px 22px', boxShadow: '0 1px 3px rgba(92,64,51,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CalendarDays size={16} color="#D98292" />
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>今週の予約状況</p>
        </div>
        <button
          onClick={() => setShowDetail(true)}
          style={{
            fontSize: '11px', fontWeight: 700, color: '#D98292', background: '#fff',
            border: '1px solid #D98292', borderRadius: '999px', padding: '4px 12px', cursor: 'pointer',
          }}
        >
          詳細
        </button>
      </div>

      {/* 今日/明日/週末の即時把握用サマリー(強調・装飾は増やさない) */}
      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' }}>
        <Stat label="今日" value={`${countOf(todayKey)}件`} color="#D14F4F" />
        <Stat label="明日" value={`${countOf(tomorrowKey)}件`} color="#D98292" />
        <Stat label="週末(土日)" value={`${weekendCount}件`} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.dayOfWeekCounts.map(({ dayOfWeek, count }) => {
          const isToday = dayOfWeek === todayKey
          const isTomorrow = dayOfWeek === tomorrowKey
          const dayColor = dayOfWeek === 'sun' ? '#D14F4F' : dayOfWeek === 'sat' ? '#5A87C7' : '#9F7E6C'
          return (
            <div
              key={dayOfWeek}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: isToday ? 'rgba(240,72,122,0.06)' : 'transparent',
                borderRadius: '8px', padding: isToday ? '3px 6px' : '3px 6px',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, color: dayColor, width: '14px', flexShrink: 0 }}>{DAY_LABEL_JA[dayOfWeek]}</span>
              {(isToday || isTomorrow) && (
                <span
                  style={{
                    fontSize: '9px', fontWeight: 700, color: isToday ? '#fff' : '#D98292',
                    background: isToday ? '#F0487A' : 'rgba(217,130,146,0.12)',
                    borderRadius: '999px', padding: '1px 6px', flexShrink: 0,
                  }}
                >
                  {isToday ? '今日' : '明日'}
                </span>
              )}
              <div style={{ flex: 1, background: '#FFF8F7', borderRadius: '999px', height: '10px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.max((count / maxCount) * 100, count > 0 ? 4 : 0)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #F56E8B, #F0487A)',
                    borderRadius: '999px',
                  }}
                />
              </div>
              <span style={{ fontSize: '11px', color: '#5C4033', width: '32px', textAlign: 'right', flexShrink: 0 }}>{count}件</span>
            </div>
          )
        })}
      </div>

      <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Stat label="今週予約件数" value={`${data.totalCount}件`} />
        <Stat label="今週予測売上" value={formatYen(data.forecastSales)} />
      </div>

      {showDetail && <WeeklyReservationsDetailModal data={data} onClose={() => setShowDetail(false)} />}
    </div>
  )
}

/**
 * 「今月危険アラート」カード(PHASE ADMIN-COMPLETE-1)。computeRiskAlerts()の出力を
 * critical/warningの重要度で色分けして並べるだけ(新しい判定ロジックはここに書かない)。
 */
function RiskAlertsCard({ alerts }: { alerts: RiskAlert[] }) {
  return (
    <SectionCard title="今月危険アラート" icon={<ShieldAlert size={16} color="#D14F4F" />}>
      {alerts.length === 0 ? (
        <p style={{ fontSize: '12px', color: '#C8A8B0' }}>現在、危険アラートはありません</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {alerts.map((a, i) => {
            const color = a.severity === 'critical' ? '#D14F4F' : '#D98292'
            return (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '12px', background: `${color}0F`, border: `1px solid ${color}33` }}>
                <AlertTriangle size={14} color={color} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, color }}>{a.title}</p>
                  <p style={{ fontSize: '12px', color: '#5C4033', marginTop: '2px', lineHeight: 1.5 }}>{a.message}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

/** 「今月良かったこと」カード(PHASE ADMIN-COMPLETE-1)。computeGoodNews()の出力を箇条書きするだけ。 */
function GoodNewsCard({ items }: { items: GoodNewsItem[] }) {
  return (
    <SectionCard title="今月良かったこと" icon={<Sparkles size={16} color="#D98F3C" />}>
      {items.length === 0 ? (
        <p style={{ fontSize: '12px', color: '#C8A8B0' }}>データが揃うと表示されます</p>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((item, i) => (
            <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12px', color: '#5C4033', lineHeight: 1.6 }}>
              <span style={{ color: '#D98F3C', fontWeight: 700, flexShrink: 0 }}>・</span>
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/** 「今週やること」カード(PHASE ADMIN-COMPLETE-1)。computeWeeklyFocus()の出力を箇条書きするだけ。 */
function WeeklyFocusCard({ items }: { items: WeeklyFocusItem[] }) {
  return (
    <SectionCard title="今週やること" icon={<ListChecks size={16} color="#7C9CC4" />}>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12px', color: '#5C4033', lineHeight: 1.6 }}>
            <span style={{ color: '#7C9CC4', fontWeight: 700, flexShrink: 0 }}>・</span>
            {item.message}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

function DashboardHomeContent() {
  const { data, isLoading, error, fetchTop } = useDashboardTopStore()
  const { settings: businessSettings, fetchSettings } = useBusinessSettingsStore()
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
    fetchTop(DEMO_STORE_ID, selectedMonth)
  }, [fetchTop, selectedMonth])

  // PHASE MD-1: 人件費率の内訳取得。既存の /api/admin/business-settings
  // （BusinessSettingsFormが既に使用しているAPI）をそのまま流用し、新規API・API変更は行わない。
  useEffect(() => {
    fetchSettings(DEMO_STORE_ID, `${selectedMonth}-01`)
  }, [fetchSettings, selectedMonth])

  if (isLoading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '60px 0', color: '#C8A8B0' }}>
        <Loader2 size={20} className="animate-spin" style={{ marginRight: '8px' }} />
        読み込み中...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: '#D14F4F', fontSize: '13px' }}>
        経営TOPの取得に失敗しました: {error}
      </div>
    )
  }

  if (!data) return null

  const { required4, kpi4, extendedKpi, todayActions, salesTrend, csvImportStatus, weeklyReservations } = data

  // PHASE MD-1: 客単価 = monthlySales ÷ visitCount（フロント側derived値。バックエンド集計は追加しない）
  const avgSpend = extendedKpi.visitCount !== null && extendedKpi.visitCount > 0
    ? Math.round(required4.monthlySales / extendedKpi.visitCount)
    : null

  // PHASE MD-1: 人件費率 = (人件費合計 ÷ monthlySales) × 100
  const laborCostTotal = sumLaborCosts(businessSettings?.fixedCosts ?? null)
  const laborCostRate = laborCostTotal !== null && required4.monthlySales > 0
    ? (laborCostTotal / required4.monthlySales) * 100
    : null

  // PHASE ADMIN-COMPLETE-1: 利益見込みカードの内訳(広告費・その他固定費)。
  // 計算式・APIは変更せず、既存fixedCostsをフロント側で読み替えるだけ(人件費と同方式)。
  const adCostTotal = sumCostKeys(businessSettings?.fixedCosts ?? null, AD_COST_KEYS)

  const currentYM = new Date().toISOString().slice(0, 7)
  const isCurrentMonth = selectedMonth === currentYM
  const monthLabel = isCurrentMonth
    ? '今月'
    : `${Number(selectedMonth.slice(5, 7))}月`

  // PHASE ADMIN-COMPLETE-1: 危険アラート/良かったこと/今週やること。
  // 既存API応答(required4/kpi4/extendedKpi/todayActions/salesTrend)だけを入力にする
  // 純粋関数(computeDashboardHighlights.ts)の出力をそのまま表示する。
  const highlightsInput = {
    monthlySales: required4.monthlySales,
    salesTarget: kpi4.salesTarget,
    targetProgress: kpi4.targetProgress,
    laborCostRate,
    nominationRate: extendedKpi.nominationRate,
    todayActions,
    salesTrend,
    asOfDate: data.date,
    month: data.month,
  }
  const riskAlerts = computeRiskAlerts(highlightsInput)
  const goodNews = computeGoodNews(highlightsInput)
  const weeklyFocus = computeWeeklyFocus(highlightsInput)

  return (
    <div className="p-5 sm:p-6 lg:p-10" style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '-4px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#C8A8B0' }}>表示月</p>
        <MonthSelector />
      </div>

      {/* ── ① 経営TOP・優先順位1: 本日の売上(ヒーロー表示・表示月に関わらず常に「今日」) ── */}
      <TodaySalesHero amount={kpi4.todaySales} />

      {/* ── PHASE ADMIN-COMPLETE-1: 危険アラート/良かったこと/今週やること(オーナーが毎日見る前提で上位に配置) ── */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <RiskAlertsCard alerts={riskAlerts} />
        <GoodNewsCard items={goodNews} />
        <WeeklyFocusCard items={weeklyFocus} />
      </div>

      {/* ── 優先順位2〜4: 今月売上・利益見込み・人件費率・損益分岐点 ── */}
      <SectionCard title={`${monthLabel}の経営(必須4指標)`} icon={<CalendarCheck size={16} color="#D98292" />}>
        <StatGrid>
          <Stat label={`${monthLabel}売上`} value={`${formatYen(required4.monthlySales)} / 目標 ${kpi4.salesTarget !== null ? formatYen(kpi4.salesTarget) : '未設定'}`} />
          <Stat
            label="利益見込み(暫定)"
            value={required4.fixedCostsConfigured ? formatYen(required4.profit ?? 0) : '設定待ち'}
            color={required4.profit !== null && required4.profit < 0 ? '#D14F4F' : '#5C4033'}
            hint={required4.fixedCostsConfigured ? undefined : '固定費が未設定です'}
          />
          <Stat
            label="人件費率"
            value={laborCostRate === null ? '—' : `${laborCostRate.toFixed(1)}%`}
            color={laborCostColor(laborCostRate)}
            hint="人件費(固定費)が未設定です"
          />
          <Stat
            label="損益分岐点"
            value={required4.breakevenPoint === null ? '—' : formatYen(required4.breakevenPoint)}
            hint="固定費が未設定です"
          />
          <Stat
            label="損益分岐まで"
            value={required4.breakevenRemaining === null ? '—' : formatYen(required4.breakevenRemaining)}
            hint="固定費が未設定です"
          />
          <Stat label="着地予測" value={formatYen(required4.forecastSales)} />
        </StatGrid>
        <CostBreakdownMini fixedCostTotal={required4.fixedCostTotal} laborCostTotal={laborCostTotal} adCostTotal={adCostTotal} />
        {!required4.fixedCostsConfigured && (
          <Link
            href="/admin/business-settings"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', marginTop: '10px',
              fontSize: '11px', fontWeight: 700, color: '#D98292', textDecoration: 'none',
            }}
          >
            <Settings size={12} /> 固定費を設定する(利益・損益分岐の計算に必要です)
          </Link>
        )}
      </SectionCard>

      {/* ── 優先順位5: 今週予約状況 ── */}
      <WeeklyReservationsCard data={weeklyReservations} />

      {/* ── 優先順位6: 今日の一手 ── */}
      <SectionCard title="今日の一手(AI・一行指示)" icon={<MessageCircleHeart size={16} color="#D98292" />}>
        {todayActions.length === 0 ? (
          <p style={{ fontSize: '12px', color: '#C8A8B0' }}>本日の指示はありません</p>
        ) : (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {todayActions.map((action, i) => {
              const { color, bg, Icon, label } = SEVERITY_STYLE[action.severity]
              return (
                <div key={i} style={{ borderRadius: '12px', padding: '10px 12px', background: bg, border: `1px solid ${color}33`, minHeight: '112px', display: 'flex' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', width: '100%' }}>
                    <Icon size={14} color={color} style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color }}>{action.title}</span>
                        <span style={{ fontSize: '9px', color, opacity: 0.8 }}>{label}</span>
                        <span style={{ fontSize: '9px', color: '#9F7E6C' }}>対象{action.targetCount}件</span>
                      </div>
                      <p
                        style={{
                          fontSize: '12px', color: '#5C4033', lineHeight: 1.5,
                          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {action.message}
                      </p>
                      <span
                        style={{
                          display: 'inline-block', marginTop: '5px', fontSize: '10px', fontWeight: 700,
                          color: '#fff', background: color, borderRadius: '999px', padding: '2px 8px',
                        }}
                      >
                        {ACTION_TYPE_LABEL[action.actionType]}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── 参考指標(補足・優先順位は下げるが情報は削らない) ── */}
      <SectionCard title="目標・予約指標(参考)" icon={<Target size={16} color="#D98292" />}>
        <StatGrid>
          <Stat label="目標進捗" value={formatPercent(kpi4.targetProgress)} hint="売上目標が未設定です" />
          <Stat label="次回予約率" value={formatPercent(kpi4.rebookingRate)} hint="集計データがまだありません" />
          <Stat label="DM→予約転換率" value={formatPercent(kpi4.dmToBookingRate)} hint="集計データがまだありません" />
        </StatGrid>
      </SectionCard>

      <SectionCard title="来店・リピート・指名(月次)" icon={<Users size={16} color="#D98292" />}>
        <StatGrid>
          <Stat label="来店人数" value={extendedKpi.visitCount !== null ? `${extendedKpi.visitCount}人` : '—'} hint="集計データがまだありません" />
          <Stat label="客単価" value={avgSpend === null ? '—' : formatYenFull(avgSpend)} hint="来店データがありません" />
          <Stat label="リピート率(30日)" value={formatPercent(extendedKpi.repeat30)} hint="データ不足のため未計測" />
          <Stat label="リピート率(60日)" value={formatPercent(extendedKpi.repeat60)} hint="データ不足のため未計測" />
          <Stat label="リピート率(90日)" value={formatPercent(extendedKpi.repeat90)} hint="データ不足のため未計測" />
          <Stat label="指名率" value={formatPercent(extendedKpi.nominationRate)} hint="来店データがありません" />
        </StatGrid>
      </SectionCard>

      <SectionCard title="CSV取込状況" icon={<UploadCloud size={16} color="#D98292" />}>
        {csvImportStatus === null ? (
          <p style={{ fontSize: '12px', color: '#C8A8B0' }}>取込履歴はまだありません</p>
        ) : (
          <StatGrid>
            <Stat label="最終取込" value={formatDateTime(csvImportStatus.lastImportedAt)} />
            <Stat label="新規/更新" value={`${csvImportStatus.newCustomers}/${csvImportStatus.updatedCustomers}`} />
            <Stat label="来店取込" value={`${csvImportStatus.visitsImported}件`} />
            <Stat
              label="未解決スタッフ"
              value={`${csvImportStatus.unresolvedStaffCount}件`}
              color={csvImportStatus.unresolvedStaffCount > 0 ? '#D14F4F' : '#5C4033'}
            />
          </StatGrid>
        )}
      </SectionCard>

      <SectionCard title="売上推移(選択月・日次)" icon={<LineChart size={16} color="#D98292" />}>
        <SalesTrendChart points={salesTrend} />
      </SectionCard>
    </div>
  )
}

export default function DashboardHomeScreen() {
  return (
    <Suspense>
      <DashboardHomeContent />
    </Suspense>
  )
}

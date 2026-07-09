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
 */
import { useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { TrendingUp, Target, CalendarCheck, MessageCircleHeart, AlertTriangle, AlertCircle, Info, UploadCloud, Loader2, Users, Settings } from 'lucide-react'
import { useDashboardTopStore, type TodayAction } from '@/store/useDashboardTopStore'
import { useBusinessSettingsStore } from '@/store/useBusinessSettingsStore'
import { useMonthStore } from '@/store/useMonthStore'
import MonthSelector from '../MonthSelector'
import { DEMO_STORE_ID } from '@/lib/constants'

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

function formatYen(amount: number): string {
  return `¥${Math.round(amount / 1000).toLocaleString()}K`
}

function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
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

function sumLaborCosts(fixedCosts: Record<string, unknown> | null): number | null {
  if (!fixedCosts) return null
  let total = 0
  let hasValue = false
  for (const key of LABOR_COST_KEYS) {
    const v = fixedCosts[key]
    if (typeof v === 'number' && Number.isFinite(v)) { total += v; hasValue = true }
  }
  return hasValue ? total : null
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
        {icon}
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>{title}</p>
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, color = '#5C4033' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: '100px', background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px', border: '1px solid #F5EEF0' }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
      <p style={{ fontSize: '18px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif', lineHeight: 1.1 }}>{value}</p>
    </div>
  )
}

function SalesTrendChart({ points }: { points: { snapshotDate: string; monthlySales: number; forecastSales: number }[] }) {
  if (points.length === 0) {
    return <p style={{ fontSize: '12px', color: '#C8A8B0', padding: '12px 0' }}>当月のスナップショットはまだありません</p>
  }
  const max = Math.max(...points.map((p) => Math.max(p.monthlySales, p.forecastSales)), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px', padding: '4px 0' }}>
      {points.map((p) => (
        <div
          key={p.snapshotDate}
          title={`${p.snapshotDate}: ${formatYen(p.monthlySales)}`}
          style={{
            flex: 1,
            height: `${Math.max((p.monthlySales / max) * 100, 2)}%`,
            background: 'linear-gradient(180deg, #F56E8B, #F0487A)',
            borderRadius: '3px 3px 0 0',
            minWidth: '4px',
          }}
        />
      ))}
    </div>
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

  const { required4, kpi4, extendedKpi, todayActions, salesTrend, csvImportStatus } = data

  // PHASE MD-1: 客単価 = monthlySales ÷ visitCount（フロント側derived値。バックエンド集計は追加しない）
  const avgSpend = extendedKpi.visitCount !== null && extendedKpi.visitCount > 0
    ? Math.round(required4.monthlySales / extendedKpi.visitCount)
    : null

  // PHASE MD-1: 人件費率 = (人件費合計 ÷ monthlySales) × 100
  const laborCostTotal = sumLaborCosts(businessSettings?.fixedCosts ?? null)
  const laborCostRate = laborCostTotal !== null && required4.monthlySales > 0
    ? (laborCostTotal / required4.monthlySales) * 100
    : null

  const currentYM = new Date().toISOString().slice(0, 7)
  const isCurrentMonth = selectedMonth === currentYM
  const monthLabel = isCurrentMonth
    ? '今月'
    : `${Number(selectedMonth.slice(5, 7))}月`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '-4px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#C8A8B0' }}>表示月</p>
        <MonthSelector />
      </div>
      <SectionCard title={`${monthLabel}の経営(必須4指標)`} icon={<TrendingUp size={16} color="#D98292" />}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <Stat label="売上" value={`${formatYen(required4.monthlySales)} / 目標 ${kpi4.salesTarget !== null ? formatYen(kpi4.salesTarget) : '未設定'}`} />
          <Stat
            label="利益(暫定)"
            value={required4.fixedCostsConfigured ? formatYen(required4.profit ?? 0) : '設定待ち'}
            color={required4.profit !== null && required4.profit < 0 ? '#D14F4F' : '#5C4033'}
          />
          <Stat
            label="損益分岐点"
            value={required4.breakevenPoint === null ? '—' : formatYen(required4.breakevenPoint)}
          />
          <Stat
            label="損益分岐まで"
            value={required4.breakevenRemaining === null ? '—' : formatYen(required4.breakevenRemaining)}
          />
          <Stat label="着地予測" value={formatYen(required4.forecastSales)} />
          <Stat
            label="人件費率"
            value={laborCostRate === null ? '—' : `${laborCostRate.toFixed(1)}%`}
          />
        </div>
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

      <SectionCard title="KPI(これだけ・異常値で色)" icon={<Target size={16} color="#D98292" />}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <Stat label="本日売上" value={formatYen(kpi4.todaySales)} />
          <Stat label="目標進捗" value={formatPercent(kpi4.targetProgress)} />
          <Stat label="次回予約率" value={formatPercent(kpi4.rebookingRate)} />
          <Stat label="DM→予約転換率" value={formatPercent(kpi4.dmToBookingRate)} />
        </div>
      </SectionCard>

      <SectionCard title="来店・リピート・指名(月次)" icon={<Users size={16} color="#D98292" />}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <Stat label="来店人数" value={extendedKpi.visitCount !== null ? `${extendedKpi.visitCount}人` : '—'} />
          <Stat label="客単価" value={avgSpend === null ? '—' : formatYen(avgSpend)} />
          <Stat label="リピート率(30日)" value={formatPercent(extendedKpi.repeat30)} />
          <Stat label="リピート率(60日)" value={formatPercent(extendedKpi.repeat60)} />
          <Stat label="リピート率(90日)" value={formatPercent(extendedKpi.repeat90)} />
          <Stat label="指名率" value={formatPercent(extendedKpi.nominationRate)} />
        </div>
      </SectionCard>

      <SectionCard title="今日の一手(AI・一行指示)" icon={<MessageCircleHeart size={16} color="#D98292" />}>
        {todayActions.length === 0 ? (
          <p style={{ fontSize: '12px', color: '#C8A8B0' }}>本日の指示はありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {todayActions.map((action, i) => {
              const { color, bg, Icon, label } = SEVERITY_STYLE[action.severity]
              return (
                <div key={i} style={{ borderRadius: '12px', padding: '10px 12px', background: bg, border: `1px solid ${color}33` }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <Icon size={14} color={color} style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color }}>{action.title}</span>
                        <span style={{ fontSize: '9px', color, opacity: 0.8 }}>{label}</span>
                        <span style={{ fontSize: '9px', color: '#9F7E6C' }}>対象{action.targetCount}件</span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.5 }}>{action.message}</p>
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

      <SectionCard title="CSV取込状況" icon={<UploadCloud size={16} color="#D98292" />}>
        {csvImportStatus === null ? (
          <p style={{ fontSize: '12px', color: '#C8A8B0' }}>取込履歴はまだありません</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <Stat label="最終取込" value={formatDateTime(csvImportStatus.lastImportedAt)} />
            <Stat label="新規/更新" value={`${csvImportStatus.newCustomers}/${csvImportStatus.updatedCustomers}`} />
            <Stat label="来店取込" value={`${csvImportStatus.visitsImported}件`} />
            <Stat
              label="未解決スタッフ"
              value={`${csvImportStatus.unresolvedStaffCount}件`}
              color={csvImportStatus.unresolvedStaffCount > 0 ? '#D14F4F' : '#5C4033'}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title="売上推移(選択月・日次)" icon={<CalendarCheck size={16} color="#D98292" />}>
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

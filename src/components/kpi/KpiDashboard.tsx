'use client'
import React, { useEffect, useMemo } from 'react'
import { useRouter }   from 'next/navigation'
import { motion }      from 'framer-motion'
import { RefreshCw, MessageCircle, TrendingDown } from 'lucide-react'
import { useKpiStore, type KpiKey } from '@/store/useKpiStore'
import { useCustomerStore }         from '@/store/useCustomerStore'
import { buildAnalysisInput }       from '@/lib/analytics/ImprovementAnalyzer'
import { calcImprovementImpact }    from '@/lib/analytics/ImprovementImpactCalculator'
import { useAuthStore } from '@/store/useAuthStore'
import { useKpiSqlStore } from '@/store/useKpiSqlStore'
import { useDashboardStore } from '@/store/useDashboardStore'
import type { WeeklyDatum } from '@/store/useKpiStore'
import KpiCard          from './KpiCard'
import WeeklyGraph      from './WeeklyGraph'
import KpiDetailSheet   from './KpiDetailSheet'
import RepeatAnalytics  from './RepeatAnalytics'
import StoreIntelligencePanel from './StoreIntelligencePanel'
import CustomerAnalyticsPanel from './CustomerAnalyticsPanel'
import TreatmentAnalyticsPanel from './TreatmentAnalyticsPanel'
import ProductAnalyticsPanel from './ProductAnalyticsPanel'
import VipPatternPanel from './VipPatternPanel'
import StoreLearningPanel from './StoreLearningPanel'
import ChurnPreventionPanel from './phase2/ChurnPreventionPanel'
import VipPromotionPanel    from './phase2/VipPromotionPanel'
import StaffImprovementPanel from './phase2/StaffImprovementPanel'
import SalesForecastPanel    from './phase2/SalesForecastPanel'
import AppBottomNav     from '@/components/phase1/AppBottomNav'

// ─── AI改善サマリーカード（概要タブ最上部） ────────────────────────────────────

function AiImprovementSummary() {
  const { current } = useKpiStore()
  const customers   = useCustomerStore(s => s.customers)
  const P_COLOR: Record<string, string> = {
    critical: '#EF476F', high: '#F56E8B', medium: '#FFD166', low: '#74C69D',
  }
  const { topItem, totalImpact } = useMemo(() => {
    const inp = buildAnalysisInput({
      nextReserveRate:  current.nextReserveRate,
      repeatRate:       current.repeatRate,
      lineResponseRate: current.lineResponseRate,
      avgSpend:         current.avgSpend,
      vipRate:          current.vipRate,
      customers,
    })
    return calcImprovementImpact({
      ...inp,
      monthlyVisits:   customers.length || 1,
      avgSpend:        current.avgSpend || 14000,
      avgProductPrice: 4500,
    })
  }, [current, customers])

  if (!topItem) return null
  const color = P_COLOR[topItem.priority] ?? '#F56E8B'

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      style={{ margin: '0 16px 12px', background: '#fff', border: `1px solid ${color}44`, borderRadius: '16px', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '3px' }}>今月の改善余地</p>
          <p style={{ fontSize: '22px', fontWeight: 700, color: '#52B788', fontFamily: 'Inter, sans-serif' }}>
            +{totalImpact >= 10000 ? `¥${Math.round(totalImpact / 10000)}万` : `¥${totalImpact.toLocaleString()}`}
            <span style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 400 }}>/月</span>
          </p>
        </div>
        <span style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '999px', background: color + '22', color, border: `1px solid ${color}44`, fontWeight: 600 }}>
          最優先: {topItem.label}
        </span>
      </div>
      <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6, paddingLeft: '4px', borderLeft: `2px solid ${color}` }}>
        推奨: {topItem.recommendation}
      </p>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginTop: '6px', textAlign: 'right' }}>
        詳細は「📊 改善分析」タブで確認
      </p>
    </motion.div>
  )
}

// ─── KPI構成 ─────────────────────────────────────────────────────────────────

type KpiConfig = {
  key:       KpiKey
  label:     string
  format:    'currency' | 'percent' | 'number'
  icon:      string
  highlight?: boolean
}

const HERO_TOP: KpiConfig = {
  key: 'todaySales', label: '今日の売上', format: 'currency', icon: '💰', highlight: true,
}

const DETAIL_KPIS: KpiConfig[] = [
  { key: 'monthlySales',      label: '月間売上',     format: 'currency', icon: '📈' },
  { key: 'nextReserveRate',   label: '次回予約率',   format: 'percent',  icon: '🔁' },
  { key: 'avgSpend',          label: '客単価',       format: 'currency', icon: '💎' },
  { key: 'repeatRate',        label: 'リピート率',   format: 'percent',  icon: '🔁' },
  { key: 'subscContinueRate', label: 'サブスク継続', format: 'percent',  icon: '🌸' },
]

// ─── 日付 ─────────────────────────────────────────────────────────────────────

const TODAY = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function KpiDashboard() {
  const router = useRouter()
  const [mainTab, setMainTab] = React.useState<'overview' | 'churn' | 'vip' | 'staff' | 'forecast'>('overview')
  const {
    current, previousDay, previousMonth,
    weeklyData, insights,
    isLoading, lastFetchedAt,
    setSelectedKpi, fetchAll, subscribeRealtime, unsubscribeRealtime,
  } = useKpiStore()

  const { todayReservations } = useDashboardStore()

  const lineActionTargets = useMemo(() => {
    return [...todayReservations]
      .filter(r => r.churnRisk > 40 || r.daysSinceLastVisit > 30)
      .sort((a, b) => b.churnRisk - a.churnRisk)
      .slice(0, 3)
  }, [todayReservations])

  const sqlStore = useKpiSqlStore()

  const { initialized: authInitialized, session: authSession } = useAuthStore()

  useEffect(() => {
    if (!authInitialized) return
    // KPI は service role API 経由のため session 不問で取得
    sqlStore.fetchAll()
    if (authSession) {
      fetchAll()
      subscribeRealtime()
    }
    return () => unsubscribeRealtime()
  }, [authInitialized, authSession]) // eslint-disable-line react-hooks/exhaustive-deps

  // brain_visits 集計で todaySales を上書き
  const sqlCurrent = {
    ...current,
    todaySales: sqlStore.todaySales || current.todaySales,
  }

  // brain_visits 週次売上 → WeeklyDatum 変換
  const DAY_LABELS = ['日','月','火','水','木','金','土']
  const todayStr = new Date().toISOString().split('T')[0]
  const sqlWeeklyData: WeeklyDatum[] = (sqlStore.weeklySales ?? []).length > 0
    ? (sqlStore.weeklySales ?? []).map(p => {
        const d = new Date(p.date)
        return {
          day:          p.date === todayStr ? '今日' : DAY_LABELS[d.getDay()],
          sales:        p.sales ?? 0,
          reservations: 0,
        }
      })
    : weeklyData

  const lastSync = lastFetchedAt
    ? new Date(lastFetchedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div
      className="min-h-dvh max-w-[430px] mx-auto overflow-x-hidden"
      style={{
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        paddingBottom: 'calc(80px + max(12px, env(safe-area-inset-bottom)))',
      }}
    >
      {/* ── ヘッダー ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-start justify-between px-5 pb-4"
        style={{
          paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 16px))',
          background: 'rgba(253,247,248,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #F5E6E8',
          marginBottom: 16,
        }}
      >
        <div>
          <p className="text-[9px] tracking-[0.35em] mb-1" style={{ color: '#C8B0B8' }}>SALON RIORA</p>
          <h1 className="text-[22px] font-semibold leading-tight" style={{ color: '#4A2C2A' }}>KPI Dashboard</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[11px]" style={{ color: '#9E8090' }}>{TODAY}</p>
            {lastSync && (
              <span className="text-[9px]" style={{ color: '#C8B8C0' }}>· {lastSync} 更新</span>
            )}
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => fetchAll()}
          className="mt-1 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: '#FFFFFF', border: '1px solid #F5E6E8', boxShadow: '0 2px 8px rgba(245,160,181,0.10)' }}
        >
          <motion.span
            animate={isLoading ? { rotate: 360 } : { rotate: 0 }}
            transition={isLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
          >
            <RefreshCw size={14} style={{ color: '#D98292' }} />
          </motion.span>
        </motion.button>
      </motion.div>

      {/* ── ローディングバー ── */}
      {isLoading && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          className="h-0.5 origin-left"
          style={{
            margin: '0 16px 12px',
            borderRadius: 1,
            background: 'linear-gradient(to right, #D98292, #F2B6C6)',
          }}
        />
      )}

      {/* ════════ メインタブ ════════ */}
      <div style={{
        display: 'flex', gap: '6px', padding: '0 16px 12px',
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {([
          { key: 'overview',  label: '概要' },
          { key: 'churn',     label: '🚨 失客防止' },
          { key: 'vip',       label: '👑 VIP化' },
          { key: 'staff',     label: '📊 改善分析' },
          { key: 'forecast',  label: '📈 売上予測' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setMainTab(key)}
            style={{
              flexShrink: 0, fontSize: '11px', padding: '5px 14px',
              borderRadius: '999px',
              border: `1px solid ${mainTab === key ? '#F56E8B' : '#F0E8E8'}`,
              background: mainTab === key ? 'rgba(245,110,139,0.10)' : 'transparent',
              color: mainTab === key ? '#F56E8B' : '#C8A8B0',
              fontWeight: mainTab === key ? 700 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ════════ Phase2 タブコンテンツ ════════ */}
      {mainTab === 'churn'    && <ChurnPreventionPanel />}
      {mainTab === 'vip'      && <VipPromotionPanel />}
      {mainTab === 'staff'    && <StaffImprovementPanel />}
      {mainTab === 'forecast' && <SalesForecastPanel />}

      {/* ════════ 概要タブ（既存コンテンツ） ════════ */}
      {mainTab === 'overview' && <>

      {/* ════════ AI改善サマリー ════════ */}
      <AiImprovementSummary />

      {/* ════════ ヒーローKPI ════════ */}
      <div className="px-4 mb-5">
        {/* todaySales 全幅 */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mb-2.5"
        >
          <KpiCard
            label={HERO_TOP.label}
            value={sqlCurrent[HERO_TOP.key]}
            prevDayValue={previousDay[HERO_TOP.key]}
            prevMonthValue={previousMonth[HERO_TOP.key]}
            format={HERO_TOP.format}
            icon={HERO_TOP.icon}
            highlight
            onTap={() => setSelectedKpi(HERO_TOP.key)}
          />
        </motion.div>

        {/* 今月売上 / 指名数 / 次回予約率 — 3カラム */}
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: '今月売上',   value: sqlStore.monthlySales,    format: 'currency' as const, icon: '📈' },
            { label: '指名数',     value: sqlStore.nominationCount,  format: 'number'   as const, icon: '⭐' },
            { label: '次回予約率', value: sqlStore.nextBookingRate,  format: 'percent'  as const, icon: '🔁' },
          ]).map((cfg, i) => (
            <motion.div
              key={cfg.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.10 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <KpiCard
                label={cfg.label}
                value={cfg.value}
                prevDayValue={0}
                prevMonthValue={0}
                format={cfg.format}
                icon={cfg.icon}
              />
            </motion.div>
          ))}
        </div>
      </div>


      {/* ════════ 今日のLINEアクション ════════ */}
      {lineActionTargets.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42 }}
          className="mx-4 mb-5"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <MessageCircle size={12} style={{ color: '#D98292' }} />
            <span className="text-[10px] tracking-[0.22em] font-medium" style={{ color: '#C8B0B8' }}>TODAY'S LINE ACTIONS</span>
            <span
              className="ml-1 text-[9px] px-2 py-0.5 rounded-full"
              style={{ color: '#D98292', border: '1px solid #F5D6DB', background: '#FFF8FA' }}
            >
              {lineActionTargets.length}名
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {lineActionTargets.map((r, i) => {
              const riskColor = r.churnRisk >= 70 ? '#E84050' : r.churnRisk >= 50 ? '#F5A623' : '#D98292'
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.44 + i * 0.07 }}
                  className="rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #F5E6E8',
                    boxShadow: '0 2px 10px rgba(245,160,181,0.07)',
                    borderLeft: `3px solid ${riskColor}`,
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: '#4A2C2A' }}>
                      {r.customerName} 様
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px]" style={{ color: '#9E8090' }}>{r.daysSinceLastVisit}日未来店</span>
                      <span className="flex items-center gap-0.5 text-[9px] font-medium" style={{ color: riskColor }}>
                        <TrendingDown size={9} />
                        リスク {r.churnRisk}%
                      </span>
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={() => router.push('/line')}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-medium text-white"
                    style={{
                      background: 'linear-gradient(135deg, #52C87A, #3DB060)',
                      boxShadow: '0 2px 8px rgba(82,200,122,0.30)',
                    }}
                  >
                    <MessageCircle size={10} />
                    LINE送る
                  </motion.button>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* ════════ 売上推移グラフ ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.50 }}>
        <WeeklyGraph data={sqlWeeklyData} />
      </motion.div>

      {/* ════════ リピート分析 ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.62 }}>
        <RepeatAnalytics />
        {/* PHASE8: 店舗インテリジェンス（静かに成功率を上げる） */}
        <StoreIntelligencePanel />
      </motion.div>

      {/* ════════ AI店舗学習 ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.68 }}>
        <CustomerAnalyticsPanel />
      </motion.div>

      {/* ════════ 施術別分析 ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.74 }}>
        <TreatmentAnalyticsPanel />
      </motion.div>

      {/* ════════ 商品別分析 ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.80 }}>
        <ProductAnalyticsPanel />
      </motion.div>

      {/* ════════ VIP成功パターン ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.86 }}>
        <VipPatternPanel />
      </motion.div>

      {/* ════════ AI店舗学習 v1 ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.92 }}>
        <StoreLearningPanel />
      </motion.div>

      {/* ════════ AI Insights ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.72 }}>
        {insights.length > 0 && (
          <div className="mx-4 mb-5">
            <div className="flex items-center mb-2.5">
              <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>AI INSIGHTS</span>
            </div>
          </div>
        )}
      </motion.div>

      {/* ════════ 詳細KPIグリッド ════════ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.74 }}
        className="px-4 mb-5"
      >
        <div className="flex items-center mb-2.5">
          <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#C8B0B8' }}>DETAIL METRICS</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {DETAIL_KPIS.map((cfg, i) => (
            <motion.div
              key={cfg.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.76 + i * 0.05, duration: 0.35 }}
            >
              <KpiCard
                label={cfg.label}
                value={sqlCurrent[cfg.key]}
                prevDayValue={previousDay[cfg.key]}
                prevMonthValue={previousMonth[cfg.key]}
                format={cfg.format}
                icon={cfg.icon}
                onTap={() => setSelectedKpi(cfg.key)}
              />
            </motion.div>
          ))}
        </div>
      </motion.div>

      <KpiDetailSheet />
      </> /* overview end */}

      <AppBottomNav />
    </div>
  )
}

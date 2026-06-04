'use client'
import { useEffect, useMemo } from 'react'
import { useRouter }   from 'next/navigation'
import { motion }      from 'framer-motion'
import { RefreshCw, MessageCircle, TrendingDown, Sparkles, Lightbulb } from 'lucide-react'
import { useKpiStore, type KpiKey } from '@/store/useKpiStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useKpiSqlStore } from '@/store/useKpiSqlStore'
import { useDashboardStore } from '@/store/useDashboardStore'
import type { WeeklyDatum } from '@/store/useKpiStore'
import KpiCard          from './KpiCard'
import WeeklyGraph      from './WeeklyGraph'
import KpiDetailSheet   from './KpiDetailSheet'
import OccupancyHeatmap from './OccupancyHeatmap'
import RepeatAnalytics  from './RepeatAnalytics'
import StoreIntelligencePanel from './StoreIntelligencePanel'
import CustomerAnalyticsPanel from './CustomerAnalyticsPanel'
import TreatmentAnalyticsPanel from './TreatmentAnalyticsPanel'
import ProductAnalyticsPanel from './ProductAnalyticsPanel'
import VipPatternPanel from './VipPatternPanel'
import StoreLearningPanel from './StoreLearningPanel'
import SalonBoardImportPanel from './SalonBoardImportPanel'
import AppBottomNav     from '@/components/phase1/AppBottomNav'

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

const HERO_ROW: KpiConfig[] = [
  { key: 'occupancyRate',    label: '稼働率',     format: 'percent', icon: '📅' },
  { key: 'lineResponseRate', label: 'LINE返信率', format: 'percent', icon: '💬' },
  { key: 'vipRate',          label: 'VIP比率',    format: 'percent', icon: '👑' },
]

const DETAIL_KPIS: KpiConfig[] = [
  { key: 'monthlySales',      label: '月間売上',     format: 'currency', icon: '📈' },
  { key: 'nextReserveRate',   label: '次回予約率',   format: 'percent',  icon: '🔁' },
  { key: 'avgSpend',          label: '客単価',       format: 'currency', icon: '💎' },
  { key: 'repeatRate',        label: 'リピート率',   format: 'percent',  icon: '🔁' },
  { key: 'subscContinueRate', label: 'サブスク継続', format: 'percent',  icon: '🌸' },
]

// ─── AI戦略カード ─────────────────────────────────────────────────────────────

const AI_STRATEGY = [
  {
    customerName: '山田 美沙',
    riskLabel:    '失客リスク 高',
    riskColor:    '#E84050',
    riskBg:       '#FFF0F2',
    reason:       '22日間未予約 · チャーンスコア 76%',
    action:       'LINEクーポンを送り再予約を後押ししましょう',
  },
  {
    customerName: '鈴木 花子',
    riskLabel:    '3回目フォロー',
    riskColor:    '#F5A623',
    riskBg:       '#FFFBF0',
    reason:       '45日間未来店 · 次回提案率が低下中',
    action:       '保湿ケアの特別オファーを提案するタイミングです',
  },
]

// ─── 日付 ─────────────────────────────────────────────────────────────────────

const TODAY = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function KpiDashboard() {
  const router = useRouter()
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
    if (!authSession) return
    fetchAll()
    subscribeRealtime()
    sqlStore.fetchAll()
    return () => unsubscribeRealtime()
  }, [authInitialized, authSession]) // eslint-disable-line react-hooks/exhaustive-deps

  // SQL集計値で KpiSnapshot を上書き（純粋なSQL計算を優先）
  const sqlCurrent = {
    ...current,
    todaySales:       sqlStore.todaySales       || current.todaySales,
    occupancyRate:    sqlStore.occupancyRate     || current.occupancyRate,
    vipRate:          sqlStore.vipRate           || current.vipRate,
    lineResponseRate: sqlStore.lineReplyRate     || current.lineResponseRate,
    repeatRate:       sqlStore.repeatRate        || current.repeatRate,
  }

  // SQL週次売上 → WeeklyDatum 変換
  const DAY_LABELS = ['日','月','火','水','木','金','土']
  const todayStr = new Date().toISOString().split('T')[0]
  const sqlWeeklyData: WeeklyDatum[] = sqlStore.weeklySales.length > 0
    ? sqlStore.weeklySales.map(p => {
        const d = new Date(p.date)
        return {
          day:          p.date === todayStr ? '今日' : DAY_LABELS[d.getDay()],
          sales:        p.sales,
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

        {/* 稼働率 / LINE返信率 / VIP比率 — 3カラム */}
        <div className="grid grid-cols-3 gap-2">
          {HERO_ROW.map((cfg, i) => (
            <motion.div
              key={cfg.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.10 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
      </div>

      {/* ════════ AI戦略アドバイスカード ════════ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28 }}
        className="mx-4 mb-5"
      >
        <div className="flex items-center gap-2 mb-2.5">
          <Sparkles size={12} style={{ color: '#D98292' }} />
          <span className="text-[10px] tracking-[0.22em] font-medium" style={{ color: '#C8B0B8' }}>AI STRATEGY</span>
          <span
            className="ml-1 text-[9px] px-2 py-0.5 rounded-full"
            style={{ color: '#E84050', border: '1px solid #FFCDD2', background: '#FFF5F6' }}
          >
            要対応 {AI_STRATEGY.length}件
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {AI_STRATEGY.map((item, i) => (
            <motion.div
              key={item.customerName}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.30 + i * 0.08 }}
              className="rounded-2xl p-4"
              style={{
                background: '#FFFFFF',
                border: '1px solid #F5E6E8',
                boxShadow: '0 2px 12px rgba(245,160,181,0.08)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[9px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                      style={{ color: item.riskColor, background: item.riskBg }}
                    >
                      {item.riskLabel}
                    </span>
                    <span className="text-[13px] font-semibold truncate" style={{ color: '#4A2C2A' }}>
                      {item.customerName} 様
                    </span>
                  </div>
                  <p className="text-[10px] mb-2" style={{ color: '#9E8090' }}>{item.reason}</p>
                  <div className="flex items-start gap-1.5">
                    <Lightbulb size={10} style={{ color: '#D4A96A', flexShrink: 0, marginTop: 2 }} />
                    <p className="text-[11px] leading-relaxed" style={{ color: '#5C4033' }}>{item.action}</p>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.93 }}
                  onClick={() => router.push('/line')}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-medium text-white"
                  style={{
                    background: 'linear-gradient(135deg, #52C87A, #3DB060)',
                    boxShadow: '0 2px 10px rgba(82,200,122,0.30)',
                  }}
                >
                  <MessageCircle size={10} />
                  LINE送信
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

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

      {/* ════════ 稼働率ヒートマップ ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.56 }}>
        <OccupancyHeatmap />
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

      {/* ════════ CSV取込 ════════ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.96 }}>
        <SalonBoardImportPanel />
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
      <AppBottomNav />
    </div>
  )
}

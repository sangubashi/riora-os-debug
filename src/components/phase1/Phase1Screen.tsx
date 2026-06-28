'use client'
/**
 * Phase1Screen — ホーム画面 + 全フロー制御
 * CustomerBottomSheet（統合版）に正式接続済み
 */
import { useState, useMemo, useEffect, useRef }          from 'react'
import { motion, AnimatePresence }                        from 'framer-motion'
import { TrendingUp, TrendingDown }                       from 'lucide-react'
import Image                                              from 'next/image'
import { useRouter }                                      from 'next/navigation'

// stores
import { useHomeStore }  from '@/store/useHomeStore'
import { useKpiStore }   from '@/store/useKpiStore'
import { useAuthStore }  from '@/store/useAuthStore'

// types
import type { ReservationWithCustomer }           from '@/types/database'
import type { Customer as BSCustomer,
              Reservation as BSReservation }      from '@/types'

// phase1 コンポーネント
import TagFilterBar,  { type TagFilterKey }                     from './TagFilterBar'
import ReservationCard, { type Phase1Reservation,
                           type CustomerType }                  from './ReservationCard'
import AIProposalView                                           from './AIProposalView'
import ServiceLogView                                           from './ServiceLogView'
import LineUnreadSheet, { LINE_UNREAD_COUNT }                   from './LineUnreadSheet'
import AppBottomNav                                             from './AppBottomNav'

// 顧客タップ時の統一導線：音声メモ・AI提案・履歴を含む統合版シート
import CustomerBottomSheet from '@/components/customer/CustomerBottomSheet'
import { useNewCustomerSheetStore } from '@/store/useNewCustomerSheetStore'

// ─── DB行 → Phase1Reservation 変換 ───────────────────────────────────────────

function toPhase1(r: ReservationWithCustomer): Phase1Reservation {
  const lastVisit = r.customer.last_visit_date
  const daysSinceLastVisit = lastVisit
    ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / 86400000)
    : 0
  return {
    id:                 r.id,
    customerId:         r.customer_id,   // 予約IDではなく顧客IDを引き継ぐ
    scheduledAt:        r.scheduled_at,
    durationMinutes:    r.duration_minutes,
    menu:               r.menu,
    customerName:       r.customer.name,
    customerType:       (r.customer.customer_type as CustomerType) || 'VIP型',
    visitCount:         r.customer.visit_count,
    totalSpent:         r.customer.total_spent ?? 0,
    aiScore:            Math.max(0, 100 - r.customer.churn_risk_score),
    isVip:              r.customer.is_vip,
    churnRisk:          r.customer.churn_risk_score,
    daysSinceLastVisit,
    lineTags:           [],
  }
}

// ─── Phase1Reservation → CustomerBottomSheet 用 Customer / Reservation 変換 ──
// Phase1Reservation は軽量 UI 型。CustomerBottomSheet が要求する
// Customer / Reservation 型に変換して渡す。

function toCustomer(r: Phase1Reservation): BSCustomer {
  return {
    id:                    r.customerId,   // 顧客ID（予約IDではない）
    name:                  r.customerName,
    visits:                r.visitCount,
    visit_count:           r.visitCount,
    total_sales:           r.totalSpent,
    avg_price:             r.visitCount > 0
                             ? Math.round(r.totalSpent / r.visitCount) : 0,
    last_visit:            new Date(
                             Date.now() - r.daysSinceLastVisit * 86400000
                           ).toISOString().slice(0, 10),
    customer_type:         r.customerType,
    vip_rank:              r.isVip ? 4 : (r.aiScore >= 80 ? 2 : 1),
    churn_risk:            r.churnRisk,
    line_response_rate:    72,   // Phase1Reservation にない → デフォルト
    next_visit_prediction: '',
    skin_tags:             [],
    recommended_cycle_days: null,
  }
}

function toReservation(r: Phase1Reservation): BSReservation {
  return {
    id:                    r.id,
    customer_id:           null,
    customer_hash_id:      null,
    staff_id:              '',
    menu:                  r.menu,
    scheduled_at:          r.scheduledAt,
    status:                'confirmed',
    customer_name:         r.customerName,
    is_vip:                r.isVip,
    churn_risk:            r.churnRisk,
    days_since_last_visit: r.daysSinceLastVisit,
    customer_type:         r.customerType,
  }
}

// ─── タグフィルター ───────────────────────────────────────────────────────────

function matchTag(r: Phase1Reservation, tag: TagFilterKey): boolean {
  switch (tag) {
    case 'all':      return true
    case 'vip':      return r.isVip
    case 'regular':  return !r.isVip && r.visitCount >= 5
    case 'new':      return r.visitCount < 3
    case 'risk':     return r.churnRisk > 60
    case 'followup': return r.daysSinceLastVisit >= 30
    default:         return true
  }
}

// ─── 日付 ─────────────────────────────────────────────────────────────────────

function dateLabel() {
  const d  = new Date()
  const wd = ['日','月','火','水','木','金','土'][d.getDay()]
  return `${d.getMonth()+1}月${d.getDate()}日(${wd})`
}

// ─── アプリビュー ─────────────────────────────────────────────────────────────

type AppView = 'home' | 'ai_proposal' | 'service_log'

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function Phase1Screen() {
  useRouter()   // ルーター（将来の遷移用に保持）

  // ── 統合版 BottomSheet 専用 store（既存 state と完全隔離） ──────────────────
  const {
    isOpen:   newSheetOpen,
    customer: newSheetCustomer,
    reservation: newSheetReservation,
    open:     openNewSheet,
    close:    closeNewSheet,
  } = useNewCustomerSheetStore()

  const [activeTag,     setActiveTag]     = useState<TagFilterKey>('all')
  const [view,          setView]          = useState<AppView>('home')
  const [selected,      setSelected]      = useState<Phase1Reservation | null>(null)
  const [lineSheetOpen, setLineSheetOpen] = useState(false)

  // ── Supabase: 実データ取得 ────────────────────────────────────────────────
  const {
    reservations: rawReservations,
    isFallback,
    todaySales,
    yesterdaySales,
    churnRiskCount,
    fetchTodayReservations,
    fetchTodayKpi,
    fetchChurnRiskCount,
  } = useHomeStore()

  const { current }                  = useKpiStore()
  const { session, initialized }     = useAuthStore()
  const fetchedRef                   = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const uid  = session?.user?.id ?? null
    const role = (
      (session?.user?.app_metadata?.role as 'owner' | 'staff' | null) ??
      (session?.user?.user_metadata?.role as 'owner' | 'staff' | null) ??
      null
    )

    // デバッグ: 未ログインでもデモデータで表示
    Promise.allSettled([
      ...(uid ? [fetchTodayReservations(role ?? 'staff', uid)] : []),
      fetchTodayKpi(),
      fetchChurnRiskCount(),
    ])
  }, [initialized, session]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI mini ─────────────────────────────────────────────────────────────
  const dayDiff = yesterdaySales > 0
    ? +((( todaySales - yesterdaySales) / yesterdaySales) * 100).toFixed(1)
    : 0
  const isUp = dayDiff >= 0

  // ── 変換 ─────────────────────────────────────────────────────────────────
  const reservations: Phase1Reservation[] = useMemo(
    () => rawReservations.map(toPhase1),
    [rawReservations]
  )
  const filtered = useMemo(
    () => reservations.filter(r => matchTag(r, activeTag)),
    [reservations, activeTag]
  )
  const counts = useMemo<Partial<Record<TagFilterKey, number>>>(() => ({
    all:      reservations.length,
    vip:      reservations.filter(r => r.isVip).length,
    regular:  reservations.filter(r => !r.isVip && r.visitCount >= 5).length,
    new:      reservations.filter(r => r.visitCount < 3).length,
    risk:     reservations.filter(r => r.churnRisk > 60).length,
    followup: reservations.filter(r => r.daysSinceLastVisit >= 30).length,
  }), [reservations])

  // ── ハンドラ ──────────────────────────────────────────────────────────────
  /** タップ → 統合版 BottomSheet を開く（音声メモ・AI提案・履歴を含む唯一の詳細導線） */
  function handleCardTap(r: Phase1Reservation) {
    setSelected(r)
    openNewSheet(toCustomer(r), toReservation(r))
  }
  function handleServiceLog(r: Phase1Reservation)            { setSelected(r); setView('service_log') }
  function goHome()                                          { setView('home') }

  // ── レンダー ──────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col overflow-hidden relative"
      style={{
        width:       '100%',
        maxWidth:    '430px',
        marginLeft:  'auto',
        marginRight: 'auto',
        /* Safari: 100dvh で正確な高さ、フォールバックは 100svh → 100vh */
        height:      '100dvh',
        background:  'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily:  "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >

      {/* ════════════ HEADER ════════════ */}
      <div
        className="flex-shrink-0"
        style={{
          paddingTop:           'max(48px, calc(env(safe-area-inset-top) + 12px))',
          background:           'rgba(253,247,248,0.92)',
          backdropFilter:       'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom:         '1px solid #F5E6E8',
        }}
      >
        <div className="flex items-end justify-between px-5 pb-3">
          <div>
            <p className="text-[10px] font-medium tracking-[0.32em] mb-0.5"
              style={{ color: '#C8A8B0', fontFamily: 'Inter, sans-serif' }}>
              SALON RIORA
            </p>
            <h1 className="text-[22px] font-semibold leading-tight" style={{ color: '#4A2C2A' }}>
              {isFallback ? '直近の予約' : '今日の予約'}
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: '#9E8090' }}>
              {dateLabel()}
              <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
              {reservations.length}件
            </p>
          </div>

          <motion.button className="relative" whileTap={{ scale: 0.92 }}
            onClick={() => setLineSheetOpen(true)}>
            <motion.div
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}>
              <Image
                src="/characters/sunglass-bear.jpg"
                alt="サロンくま"
                width={60} height={60}
                className="rounded-full object-cover"
                style={{ border: '2.5px solid #F5E6E8', boxShadow: '0 4px 16px rgba(245,160,181,0.22)' }}
              />
            </motion.div>
            {LINE_UNREAD_COUNT > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] text-white flex items-center justify-center font-bold"
                style={{ background: '#E84050' }}>
                {LINE_UNREAD_COUNT}
              </span>
            )}
          </motion.button>
        </div>

        {/* サマリーチップ */}
        <div className="flex gap-2 px-5 pb-3">
          {[
            { label: isFallback ? '直近の予約' : '本日の予約', value: `${reservations.length}件`, color: '#F5A0B5' },
            { label: 'VIP 来店',   value: `${reservations.filter(r => r.isVip).length}名`, color: '#D4A96A' },
            { label: '要注意',     value: `${churnRiskCount}名`, color: churnRiskCount > 0 ? '#E84050' : '#52C87A' },
          ].map(chip => (
            <div key={chip.label}
              className="flex-1 rounded-[14px] py-2 flex flex-col items-center"
              style={{ background: '#FFFFFF', border: '1px solid #F5E6E8', boxShadow: '0 1px 4px rgba(245,160,181,0.08)' }}>
              <span className="text-[15px] font-semibold tabular-nums"
                style={{ color: chip.color, fontFamily: 'Inter, sans-serif' }}>
                {chip.value}
              </span>
              <span className="text-[9px] mt-0.5" style={{ color: '#9E8090' }}>{chip.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ════════════ KPI ミニカード ════════════ */}
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.3 }}
        className="flex-shrink-0 mx-4 mb-2">
        <div
          className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5"
          style={{
            background:   'linear-gradient(135deg, rgba(245,160,181,0.10) 0%, rgba(255,255,255,0.96) 100%)',
            border:       '1px solid rgba(245,160,181,0.22)',
            boxShadow:    '0 2px 10px rgba(245,160,181,0.10)',
          }}>
          <span className="text-[16px] flex-shrink-0">💰</span>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] tracking-widest" style={{ color: '#B09090' }}>本日売上</p>
            <p className="text-[15px] font-semibold tabular-nums leading-tight truncate"
              style={{ color: '#4A2C2A', fontFamily: 'Inter, sans-serif' }}>
              ¥{(current.todaySales / 10000).toFixed(1)}万
            </p>
          </div>
          <div className="flex items-center gap-0.5 text-[11px] font-semibold flex-shrink-0"
            style={{ color: isUp ? '#34D399' : '#E84050' }}>
            {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            <span>{Math.abs(dayDiff)}%</span>
          </div>
          <div className="w-px h-6 flex-shrink-0" style={{ background: '#F5E6E8' }} />
          <div className="flex-shrink-0 text-right">
            <p className="text-[9px] tracking-widest" style={{ color: '#B09090' }}>稼働率</p>
            <p className="text-[15px] font-semibold tabular-nums leading-tight"
              style={{ color: '#4A2C2A', fontFamily: 'Inter, sans-serif' }}>
              {current.occupancyRate}%
            </p>
          </div>
        </div>
      </motion.div>

      {/* ════════════ TAG FILTER ════════════ */}
      <div className="flex-shrink-0"
        style={{ background: 'rgba(253,247,248,0.80)', borderBottom: '1px solid #F5E6E8' }}>
        <TagFilterBar active={activeTag} onChange={setActiveTag} counts={counts} />
      </div>

      {/* ════════════ RESERVATION LIST ════════════ */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden pt-3"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(68px + max(12px, env(safe-area-inset-bottom)))',
          scrollbarWidth: 'none',
        }}>

        {/* 予約カードリスト */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Image src="/assets/rio-kuma.png" alt=""
              width={64} height={64} className="object-contain opacity-50" />
            <p className="text-[13px]" style={{ color: '#9E8090' }}>該当する予約はありません</p>
          </div>
        ) : (
          filtered.map((r, i) => (
            <ReservationCard
                key={r.id}
                reservation={r}
                index={i}
                onTap={handleCardTap}
              />
          ))
        )}
      </div>

      <AppBottomNav />

      {/* ════════════ OVERLAYS ════════════ */}

      {/* LINE未返信シート */}
      <LineUnreadSheet
        isOpen={lineSheetOpen}
        onClose={() => setLineSheetOpen(false)}
      />

      {/* ── 統合版 CustomerBottomSheet（タップで開く・唯一の詳細導線） ─────────
          state: useNewCustomerSheetStore で完全隔離
          viewport: 100dvh + env(safe-area-inset-bottom) 対応
          z-index: 60
      ──────────────────────────────────────────────────────────────────── */}
      {newSheetOpen && newSheetCustomer && newSheetReservation && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <CustomerBottomSheet
            customer={newSheetCustomer}
            reservation={newSheetReservation}
            onClose={closeNewSheet}
          />
        </div>
      )}

      {/* AI提案 / 接客ログ */}
      <AnimatePresence>
        {view === 'ai_proposal' && selected && (
          <AIProposalView
            key="ai-proposal"
            reservation={selected}
            onBack={goHome}
            onServiceLog={handleServiceLog}
          />
        )}
        {view === 'service_log' && selected && (
          <ServiceLogView
            key="service-log"
            reservation={selected}
            onBack={goHome}
            onSaved={goHome}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

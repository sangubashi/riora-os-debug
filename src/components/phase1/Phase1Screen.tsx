'use client'
/**
 * Phase1Screen — ホーム画面 + 全フロー制御
 *
 * KPI数値の計算元:
 *   今週の売上    brain_visits 直近7日分（weeklySalesの合算） via /api/kpi/summary
 *                 （PHASE TODAY-SALES-1: 売上はCSV取込ベースで随時反映されるリアルタイム
 *                   データではないため、「本日」ではなく「今週（直近7日）」として表示する）
 *   要注意顧客数  brain_customers + brain_visits (最終来院 >90日)
 *   LINE未返信    line_send_logs (lastDirection=incoming)
 *
 * 予約カードリストは reservations テーブル（今日の施術予定）を引き続き使用。
 * brain_visits は過去来院履歴のため、当日スケジュール表示には reservations を使う。
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence }               from 'framer-motion'
import Image                                     from 'next/image'
import { useRouter }                             from 'next/navigation'

// stores
import { useHomeStore }       from '@/store/useHomeStore'
import { useKpiSqlStore }     from '@/store/useKpiSqlStore'
import { useAuthStore }       from '@/store/useAuthStore'
import { useLineUnreadStore } from '@/store/useLineUnreadStore'

// types
import type { ReservationWithBrainCustomer } from '@/types/database'
import type { Customer as BSCustomer,
              Reservation as BSReservation } from '@/types'

// phase1 コンポーネント
import type { Phase1Reservation, CustomerType } from './ReservationCard'
import AIProposalView                         from './AIProposalView'
import ServiceLogView                         from './ServiceLogView'
import LineUnreadSheet                        from './LineUnreadSheet'
import AppBottomNav                           from './AppBottomNav'
import TodayBriefingCard                      from './TodayBriefingCard'
import InstallPrompt                           from '@/components/pwa/InstallPrompt'

import CustomerBottomSheet from '@/components/customer/CustomerBottomSheet'
import { useNewCustomerSheetStore } from '@/store/useNewCustomerSheetStore'

// ─── DB行 → Phase1Reservation 変換 ───────────────────────────────────────────

function toPhase1(r: ReservationWithBrainCustomer): Phase1Reservation {
  const bc = r.brain_customer!
  const lastVisit = bc.last_visit_date ?? null
  const daysSinceLastVisit = lastVisit
    ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / 86400000)
    : 0
  const churnRisk = Math.round(Number(bc.churn_score ?? 0) * 100)
  return {
    id:                 r.id,
    customerId:         r.brain_customer_id,
    scheduledAt:        r.scheduled_at,
    durationMinutes:    r.duration_minutes,
    menu:               r.menu,
    customerName:       bc.name,
    customerType:       (bc.customer_type as CustomerType) || 'VIP型',
    skinConcernType:    bc.customer_type ?? null,
    visitCount:         bc.visit_count    ?? 0,
    totalSpent:         bc.total_spent    ?? 0,
    isVip:              bc.is_vip         ?? (bc.total_spent ?? 0) >= 100_000,
    churnRisk,
    daysSinceLastVisit,
    lastMenu:           bc.last_menu ?? null,
    lineTags:           [],
    skin_tags:          bc.skin_tags ?? [],
  }
}

function toCustomer(r: Phase1Reservation): BSCustomer {
  return {
    id:                    r.customerId,
    name:                  r.customerName,
    visits:                r.visitCount,
    visit_count:           r.visitCount,
    total_sales:           r.totalSpent,
    avg_price:             r.visitCount > 0 ? Math.round(r.totalSpent / r.visitCount) : 0,
    last_visit:            new Date(Date.now() - r.daysSinceLastVisit * 86400000).toISOString().slice(0, 10),
    customer_type:         r.customerType,
    skinConcernType:       r.skinConcernType ?? null,
    vip_rank:              r.isVip ? 4 : 1,
    churn_risk:            r.churnRisk,
    line_response_rate:    0,
    next_visit_prediction: '',
    skin_tags:             r.skin_tags ?? [],
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

function dateLabel() {
  const d  = new Date()
  const wd = ['日','月','火','水','木','金','土'][d.getDay()]
  return `${d.getMonth()+1}月${d.getDate()}日(${wd})`
}

type AppView = 'home' | 'ai_proposal' | 'service_log'

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function Phase1Screen() {
  useRouter()

  const {
    isOpen:       newSheetOpen,
    customer:     newSheetCustomer,
    reservation:  newSheetReservation,
    open:         openNewSheet,
    close:        closeNewSheet,
  } = useNewCustomerSheetStore()

  const [view,          setView]          = useState<AppView>('home')
  const [selected,      setSelected]      = useState<Phase1Reservation | null>(null)
  const [lineSheetOpen, setLineSheetOpen] = useState(false)

  // ── データストア ──────────────────────────────────────────────────────────
  const { reservations: rawReservations, fetchTodayReservations } = useHomeStore()

  const {
    weeklySales,
    churnRiskCount,
    activeCustomerCount,
    fetchAll: fetchKpiAll,
  } = useKpiSqlStore()

  const { unreadCount, fetchUnreads } = useLineUnreadStore()
  const { session, initialized }      = useAuthStore()
  const fetchedRef                    = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const uid  = session?.user?.id ?? null
    const role = (
      (session?.user?.app_metadata?.role  as 'owner' | 'staff' | null) ??
      (session?.user?.user_metadata?.role as 'owner' | 'staff' | null) ??
      null
    )

    Promise.allSettled([
      ...(uid ? [fetchTodayReservations(role ?? 'staff', uid)] : []),
      fetchKpiAll(),
      fetchUnreads(),
    ])
  }, [initialized, session]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI 計算（brain_visits ベース）────────────────────────────────────────
  // 今週の売上 = weeklySales（直近7日の日別売上、/api/kpi/summary が既に返す値）の合算。
  // 集計ロジック自体はAPI側を変更せず、既存のweeklySalesをクライアント側で合計するのみ。
  // AUTH-2a: 店舗全体売上はowner/管理者以外にはAPIがnullを返すため、
  // その場合は売上カード自体を表示しない(下記レンダー部参照)。
  const weekSales = weeklySales
    ? weeklySales.reduce((sum, p) => sum + p.sales, 0)
    : null

  // ── 変換 ─────────────────────────────────────────────────────────────────
  const reservations: Phase1Reservation[] = useMemo(
    () => rawReservations.map(toPhase1),
    [rawReservations]
  )
  function handleCardTap(r: Phase1Reservation) {
    setSelected(r)
    openNewSheet(toCustomer(r), toReservation(r))
  }
  function handleServiceLog(r: Phase1Reservation) { setSelected(r); setView('service_log') }
  function goHome()                               { setView('home') }

  // 今日タブブリーフィングカードからのタップ → useHomeStore側の完全な予約データを
  // reservationId で引き当てて既存のCustomerBottomSheetフローに合流させる
  function handleSelectFromBriefing(reservationId: string) {
    const match = reservations.find(r => r.id === reservationId)
    if (match) handleCardTap(match)
  }

  // ── レンダー ──────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col overflow-hidden relative"
      style={{
        width:       '100%',
        maxWidth:    '430px',
        marginLeft:  'auto',
        marginRight: 'auto',
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
            <h1 className="text-[24px] font-light leading-tight" style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}>
              Today
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
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] text-white flex items-center justify-center font-bold"
                style={{ background: '#E84050' }}>
                {unreadCount}
              </span>
            )}
          </motion.button>
        </div>

        {/* サマリーチップ */}
        <div className="flex gap-2 px-5 pb-3">
          {[
            { label: '本日の予約', value: `${reservations.length}件`, color: '#F5A0B5' },
            { label: '顧客数',                                  value: `${activeCustomerCount}名`,    color: '#D4A96A' },
            { label: '要注意',                                  value: `${churnRiskCount}名`,          color: churnRiskCount > 0 ? '#E84050' : '#52C87A' },
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
            background:  'linear-gradient(135deg, rgba(245,160,181,0.10) 0%, rgba(255,255,255,0.96) 100%)',
            border:      '1px solid rgba(245,160,181,0.22)',
            boxShadow:   '0 2px 10px rgba(245,160,181,0.10)',
          }}>
          {/* AUTH-2a: 店舗全体売上はowner/管理者以外にはAPIがnullを返すため非表示にする
              (店舗全体の売上数字をスタッフ間の比較材料にしない方針) */}
          {weekSales !== null && (
            <>
              <span className="text-[16px] flex-shrink-0">💰</span>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] tracking-widest" style={{ color: '#B09090' }}>今週の売上</p>
                <p className="text-[15px] font-semibold tabular-nums leading-tight truncate"
                  style={{ color: '#4A2C2A', fontFamily: 'Inter, sans-serif' }}>
                  ¥{(weekSales / 10000).toFixed(1)}万
                </p>
                <p className="text-[8px] leading-tight truncate" style={{ color: '#C0A8A8' }}>
                  CSV反映済みデータ
                </p>
              </div>
              <div className="w-px h-6 flex-shrink-0" style={{ background: '#F5E6E8' }} />
            </>
          )}
          <div className={weekSales !== null ? 'flex-shrink-0 text-right' : 'flex-1 min-w-0'}>
            <p className="text-[9px] tracking-widest" style={{ color: '#B09090' }}>LINE未返信</p>
            <p className="text-[15px] font-semibold tabular-nums leading-tight"
              style={{ color: unreadCount > 0 ? '#E84050' : '#4A2C2A', fontFamily: 'Inter, sans-serif' }}>
              {unreadCount}件
            </p>
          </div>
        </div>
      </motion.div>

      {/* ════════════ 来店前30秒ブリーフィング（次のお客様／注意事項／このあとの予約） ════════════ */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(68px + max(12px, env(safe-area-inset-bottom)))',
          scrollbarWidth: 'none',
        }}>
        <InstallPrompt />
        <TodayBriefingCard onSelectCustomer={handleSelectFromBriefing} />
      </div>

      <AppBottomNav />

      {/* ════════════ OVERLAYS ════════════ */}

      <LineUnreadSheet isOpen={lineSheetOpen} onClose={() => setLineSheetOpen(false)} />

      {newSheetOpen && newSheetCustomer && newSheetReservation && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <CustomerBottomSheet
            customer={newSheetCustomer}
            reservation={newSheetReservation}
            onClose={closeNewSheet}
          />
        </div>
      )}

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

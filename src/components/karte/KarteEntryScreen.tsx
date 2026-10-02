'use client'
/**
 * KarteEntryScreen.tsx — `/karte`(iPad専用カルテホーム画面)の本体
 * (PHASE IPAD-KARTE-ENTRY-1・2026-09-20ユーザー承認)。
 *
 * 独自ヘッダーのみで、既存の5タブナビ(AppBottomNav)・「通常画面へ」リンクは持たない
 * (完結した導線)。本日の予約一覧(useHomeStore、Phase1Screen.tsxと同じ取得パターン)を
 * 中心に、顧客検索(useCustomerStore、CustomersScreen.tsxと同じストアだが検索ロジック
 * 自体はこの画面専用に新規実装・既存ファイルには触れない)を併設する。
 *
 * 顧客タップ時の遷移(2026-09-24ユーザー承認・不具合修正): 当初「顧客をタップすると
 * `/karte/[customerId]`へ直接遷移する」設計だったが、顧客トップページ(CustomerTopPage.tsx)
 * を挟むよう修正した。CustomerTopPage内の「詳細ページを見る→」ボタンが
 * `/karte/[customerId]`へのrouter.pushを担う(このファイル自体はrouter.pushを直接
 * 呼ばなくなった)。
 *
 * この「顧客トップページ→詳細ページ」の導線は`/karte`専用領域(このファイル)に限定する
 * (2026-09-24ユーザー承認・スマホアプリ側との分離): Phase1Screen.tsx/CustomersScreen.tsx
 * (スマホアプリ側の今日タブ/顧客タブ)は元通りCustomerBottomSheetを直接開く挙動に
 * 差し戻し済み(顧客トップページ・`/karte`への自動遷移は含まない)。スマホアプリと
 * カルテ専用画面は別物という前提のため、CustomerTopPageはこの`/karte`領域専用の
 * コンポーネントとして扱う。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Calendar, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { useHomeStore } from '@/store/useHomeStore'
import { useCustomerStore, type CustomerRow } from '@/store/useCustomerStore'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import CustomerTopPage from '@/components/customer/CustomerTopPage'
import ReservationCancelDialog from '@/components/karte/ReservationCancelDialog'
import ReservationRescheduleDialog from '@/components/karte/ReservationRescheduleDialog'
import { toast } from 'sonner'
import { formatJstMonthDayTime } from '@/lib/reservations/reschedule'
import type { ReservationWithBrainCustomer } from '@/types/database'
import type { Customer as BSCustomer, Reservation as BSReservation, CustomerType } from '@/types'
import { customerNameMatchRank } from '@/lib/customer/kanaMatch'
import { calculateAge } from '@/lib/customer/birthDate'
import { maskPhoneNumberMiddle } from '@/lib/customer/phoneMask'

// ─── CustomerRow(検索結果) → CustomerTopPage 用マッパー ─────────────────────────
// CustomersScreen.tsxのtoCustomer/toReservationと同一の変換(既存ファイルには触れず、
// この画面専用に複製する。MyStatsScreen.tsx等でも同じ複製パターンが既に採られている)。
function toCustomerFromRow(c: CustomerRow): BSCustomer {
  return {
    id:                    c.id,
    name:                  c.name,
    visits:                c.visitCount,
    visit_count:           c.visitCount,
    total_sales:           c.totalSpent,
    avg_price:             c.visitCount > 0 ? Math.round(c.totalSpent / c.visitCount) : 0,
    last_visit:            c.lastVisitDate ?? new Date(Date.now() - c.lastVisit * 86400000).toISOString().slice(0, 10),
    customer_type:         c.type,
    skinConcernType:       c.skinConcernType,
    vip_rank:              c.isVip ? 4 : 1,
    churn_risk:            c.churnRisk,
    line_response_rate:    c.lineResponseRate,
    next_visit_prediction: '',
    skin_tags:             [],
    recommended_cycle_days: undefined,
  }
}

function toReservationFromRow(c: CustomerRow): BSReservation {
  return {
    id:                    null,   // 検索結果起動時は実予約を持たない
    customer_id:           null,
    customer_hash_id:      null,
    staff_id:              c.assignedStaffId ?? '',
    menu:                  c.treatments[0] ?? '施術履歴未設定',
    scheduled_at:          new Date().toISOString(),
    status:                'confirmed',
    customer_name:         c.name,
    is_vip:                c.isVip,
    churn_risk:            c.churnRisk,
    days_since_last_visit: c.lastVisit,
    customer_type:         c.type,
  }
}

// ─── ReservationWithBrainCustomer(本日の予約) → CustomerTopPage 用マッパー ──────
function toCustomerFromReservation(r: ReservationWithBrainCustomer): BSCustomer {
  const bc = r.brain_customer
  return {
    id:                    r.brain_customer_id,
    name:                  bc.name,
    visits:                bc.visit_count ?? 0,
    visit_count:           bc.visit_count ?? 0,
    total_sales:           bc.total_spent ?? 0,
    avg_price:             bc.visit_count ? Math.round((bc.total_spent ?? 0) / bc.visit_count) : 0,
    last_visit:            bc.last_visit_date ?? new Date().toISOString().slice(0, 10),
    customer_type:         (bc.customer_type as CustomerType) || 'VIP型',
    skinConcernType:       null,
    vip_rank:              bc.is_vip ? 4 : 1,
    churn_risk:            bc.churn_score,
    line_response_rate:    0,
    next_visit_prediction: '',
    skin_tags:             bc.skin_tags ?? [],
    recommended_cycle_days: undefined,
  }
}

function toReservationFromReservation(r: ReservationWithBrainCustomer): BSReservation {
  return {
    id:                    r.id,
    customer_id:           null,
    customer_hash_id:      null,
    staff_id:              r.staff_id,
    menu:                  r.menu,
    scheduled_at:          r.scheduled_at,
    status:                'confirmed',
    customer_name:         r.brain_customer.name,
    is_vip:                r.brain_customer.is_vip ?? false,
    churn_risk:            r.brain_customer.churn_score,
    days_since_last_visit: 0,
    customer_type:         (r.brain_customer.customer_type as CustomerType) || 'VIP型',
  }
}

/** 予約カード横の「キャンセル」ボタンの通常時の文字色(stone-500相当・控えめ)。 */
const CANCEL_BUTTON_COLOR = '#78716C'

const formatTimeJst = (iso: string) =>
  new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })

function rescheduleErrorMessage(code: string): string {
  switch (code) {
    case 'invalid_datetime':
      return '日付と時間を正しく選んでください。'
    case 'past_datetime':
      return '過去の日時には予約できません。'
    case 'same_datetime':
      return 'いまの予約と同じ日時です。別の日時を選んでください。'
    case 'invalid_status':
    case 'conflict':
      return '予約の状態が変更されています。一覧を更新しました。'
    case 'forbidden':
      return 'この予約を操作する権限がありません。'
    case 'unauthorized':
      return 'ログインの有効期限が切れています。再ログインしてください。'
    default:
      return '処理に失敗しました。もう一度お試しください。'
  }
}

function cancelErrorMessage(code: string): string {
  switch (code) {
    case 'already_cancelled':
    case 'not_cancelled':
    case 'conflict':
    case 'invalid_status':
    case 'not_manual_cancel':
      return '予約の状態が変更されています。一覧を更新しました。'
    case 'forbidden':
      return 'この予約を操作する権限がありません。'
    case 'unauthorized':
      return 'ログインの有効期限が切れています。再ログインしてください。'
    default:
      return '処理に失敗しました。もう一度お試しください。'
  }
}

export default function KarteEntryScreen() {
  const router = useRouter()
  const session = useAuthStore(s => s.session)
  const [selected, setSelected] = useState<{ customer: BSCustomer; reservation?: BSReservation } | null>(null)
  const {
    reservations, cancelledToday, isLoading: reservationsLoading, fetchTodayReservations,
    cancelReservation, restoreReservation, rescheduleReservation,
  } = useHomeStore()
  // 別日に予約(2026-10-02): 対象・処理中・エラー・担当スタッフの別予約との重なり警告。
  const [rescheduleTarget, setRescheduleTarget] = useState<ReservationWithBrainCustomer | null>(null)
  const [rescheduleBusy, setRescheduleBusy] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [rescheduleOverlap, setRescheduleOverlap] = useState(false)
  // 当日キャンセル機能(2026-10-01): 確認モーダル対象・処理中・エラー・「当日キャンセル」欄の開閉。
  const [cancelTarget, setCancelTarget] = useState<ReservationWithBrainCustomer | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<ReservationWithBrainCustomer | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelledOpen, setCancelledOpen] = useState(false)
  const { customers, isLoading: customersLoading, fetchCustomers } = useCustomerStore()
  const [query, setQuery] = useState('')
  const fetchedRef = useRef(false)

  // Phase1Screen.tsxのuseHomeStore呼び出しと同じrole/uid算出パターン(無変更で踏襲)。
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const uid = session?.user?.id ?? null
    const role = (
      (session?.user?.app_metadata?.role as 'owner' | 'staff' | null) ??
      (session?.user?.user_metadata?.role as 'owner' | 'staff' | null) ??
      null
    )

    if (uid) void fetchTodayReservations(role ?? 'staff', uid)
    void fetchCustomers()
  }, [session, fetchTodayReservations, fetchCustomers])

  const filteredCustomers = useMemo(() => {
    const rawQuery = query.trim()
    if (!rawQuery) return []
    // 部分一致検索(2026-10-02ユーザー指示で強化): ひらがな/カタカナの差と空白を無視し、姓名をまたぐ入力
    // (例:「しもつり」→「下津 里恵(シモツ リエ)」)でも一致させる。ひらがな・カタカナのみの入力は
    // フリガナだけを見て、漢字表記の名前への偶然の一致を避ける(詳細は kanaMatch.ts の customerNameMatchRank)。
    // 先頭一致を先に、途中一致を後に並べる。
    const ranked: { c: CustomerRow; rank: 0 | 1 }[] = []
    for (const c of customers) {
      const rank = customerNameMatchRank(c.name, c.nameKana, rawQuery)
      if (rank !== null) ranked.push({ c, rank })
    }
    return ranked.sort((x, y) => x.rank - y.rank).map(x => x.c).slice(0, 30)
  }, [customers, query])

  // 同姓同名の識別表示(2026-09-28ユーザー承認): 検索結果一覧内で漢字氏名・フリガナが
  // 共に一致する顧客が2件以上いる場合のみ、対象カードに識別情報(バッジ・電話番号中央
  // マスキング・年齢・前回来店日)を表示する。それ以外の通常カードは従来通りの表示。
  const duplicateNameKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of filteredCustomers) {
      const key = `${c.name}::${c.nameKana ?? ''}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set(Array.from(counts.entries()).filter(([, n]) => n >= 2).map(([key]) => key))
  }, [filteredCustomers])

  const openCustomerFromSearch = (c: CustomerRow) =>
    setSelected({ customer: toCustomerFromRow(c), reservation: toReservationFromRow(c) })
  const openCustomerFromReservation = (r: ReservationWithBrainCustomer) =>
    setSelected({ customer: toCustomerFromReservation(r), reservation: toReservationFromReservation(r) })

  const closeCancelDialogs = () => { setCancelTarget(null); setRestoreTarget(null); setCancelError(null) }

  const closeRescheduleDialog = () => {
    setRescheduleTarget(null); setRescheduleError(null); setRescheduleOverlap(false)
  }

  // 二重送信防止: rescheduleBusy中は何もしない(ボタン自体もdisabled)。
  async function runReschedule(input: { date: string; time: string; allowOverlap: boolean }) {
    if (!rescheduleTarget || rescheduleBusy) return
    setRescheduleBusy(true)
    setRescheduleError(null)
    const result = await rescheduleReservation(rescheduleTarget, input)
    setRescheduleBusy(false)
    if (result.ok) {
      const name = rescheduleTarget.brain_customer.name
      closeRescheduleDialog()
      setCancelledOpen(true)
      toast.success(`${name}様を ${formatJstMonthDayTime(result.scheduledAt)} に予約しました`)
      return
    }
    if (result.overlap) { setRescheduleOverlap(true); return }
    setRescheduleOverlap(false)
    setRescheduleError(rescheduleErrorMessage(result.error))
  }

  // 二重送信防止: cancelBusy中は何もしない(ボタン自体もdisabled)。
  async function runCancelAction(kind: 'cancel' | 'restore') {
    const target = kind === 'cancel' ? cancelTarget : restoreTarget
    if (!target || cancelBusy) return
    setCancelBusy(true)
    setCancelError(null)
    const result = kind === 'cancel' ? await cancelReservation(target) : await restoreReservation(target)
    setCancelBusy(false)
    if (result.ok) {
      closeCancelDialogs()
      if (kind === 'cancel') setCancelledOpen(true)
      return
    }
    setCancelError(cancelErrorMessage(result.error))
  }

  // 本日のJST日付を「2026/09/20 (日)」形式で表示する(PHASE IPAD-KARTE-ENTRY-1 UI刷新・
  // 2026-09-20ユーザー承認)。サーバー側todayJst()とは独立(表示専用・クエリには使わない)。
  const todayLabel = useMemo(() => {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(new Date())
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    return `${get('year')}/${get('month')}/${get('day')} (${get('weekday')})`
  }, [])

  return (
    <div style={{ minHeight: '100dvh', background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 32px 16px',
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <p style={{ margin: 0, fontSize: '22px', color: PALETTE.gold, letterSpacing: '0.01em', fontFamily: headingFont.style.fontFamily, justifySelf: 'start' }}>
          Salon Riora
        </p>
        <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text, letterSpacing: '0.02em', justifySelf: 'center', whiteSpace: 'nowrap' }}>
          {todayLabel}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifySelf: 'end' }}>
          {/* 使い方ガイド導線(2026-09-27ユーザー承認・第一弾)。/karte/guideへの入口。 */}
          <button
            type="button"
            onClick={() => router.push('/karte/guide')}
            aria-label="カルテ画面の使い方ガイドを開く"
            style={{
              display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 2px',
              border: 'none', background: 'none', color: PALETTE.muted, fontSize: '11px', cursor: 'pointer',
            }}
          >
            <HelpCircle size={14} />使い方
          </button>
          <p
            style={{
              margin: 0, fontSize: '11px', letterSpacing: '0.15em', color: PALETTE.gold, textTransform: 'uppercase',
              paddingBottom: '4px', borderBottom: `1px solid ${PALETTE.gold}`,
            }}
          >
            KARTE
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 48px' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto' }}>
          {/* 顧客検索 */}
          <div style={{ position: 'relative', marginBottom: '28px' }}>
            <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: PALETTE.muted }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="お客様を検索 (お名前)"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '13px 14px 13px 40px', borderRadius: '12px',
                border: `1px solid ${PALETTE.border}`, background: PALETTE.card, fontSize: '15px',
                color: PALETTE.text, outline: 'none',
              }}
            />
          </div>

          {query.trim() ? (
            <div>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: PALETTE.muted }}>
                検索結果 {filteredCustomers.length}件
              </p>
              {customersLoading && <p style={{ fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredCustomers.map(c => {
                  const isDuplicate = duplicateNameKeys.has(`${c.name}::${c.nameKana ?? ''}`)
                  if (!isDuplicate) {
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => openCustomerFromSearch(c)}
                        style={{
                          textAlign: 'left', padding: '14px 16px', borderRadius: '12px',
                          border: `1px solid ${PALETTE.border}`, background: PALETTE.card,
                          cursor: 'pointer', fontSize: '14px', color: PALETTE.text,
                        }}
                      >
                        {c.name}様
                      </button>
                    )
                  }

                  const maskedPhone = c.phoneNumber ? maskPhoneNumberMiddle(c.phoneNumber) : null
                  const age         = c.birthDate ? calculateAge(c.birthDate) : null
                  const lastVisitLabel = c.lastVisitDate ? c.lastVisitDate.replaceAll('-', '/') : '来店履歴なし'

                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openCustomerFromSearch(c)}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: '6px',
                        textAlign: 'left', padding: '14px 16px', borderRadius: '12px',
                        border: `1px solid ${PALETTE.border}`, background: PALETTE.card,
                        cursor: 'pointer', fontSize: '14px', color: PALETTE.text,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{c.name}様</span>
                        <span
                          style={{
                            fontSize: '10px', fontWeight: 600, color: '#B85050',
                            background: 'rgba(184,80,80,0.12)', borderRadius: '999px', padding: '2px 8px',
                          }}
                        >
                          同姓同名
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '11px', color: PALETTE.muted }}>
                        {maskedPhone && <span>TEL {maskedPhone}</span>}
                        {age !== null && <span>{age}歳</span>}
                        <span>前回来店 {lastVisitLabel}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <p
                  style={{
                    margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '13px', color: PALETTE.gold, letterSpacing: '0.04em',
                    fontFamily: headingFont.style.fontFamily,
                  }}
                >
                  <Calendar size={14} strokeWidth={1.8} />
                  本日の予約
                </p>
                <span
                  style={{
                    fontSize: '12px', color: PALETTE.gold, background: 'rgba(173,138,84,0.12)',
                    borderRadius: '999px', padding: '2px 10px', fontWeight: 600,
                  }}
                >
                  {reservations.length}件
                </span>
              </div>
              {reservationsLoading && <p style={{ fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>}
              {!reservationsLoading && reservations.length === 0 && (
                <p style={{ fontSize: '13px', color: PALETTE.muted }}>本日の予約はありません</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {reservations.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <button
                    type="button"
                    onClick={() => openCustomerFromReservation(r)}
                    style={{
                      flex: 1, minWidth: 0,
                      display: 'flex', alignItems: 'center',
                      textAlign: 'left', padding: '14px 16px', borderRadius: '12px',
                      border: `1px solid ${PALETTE.border}`, background: PALETTE.card, cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '14px', color: PALETTE.gold, fontWeight: 600, minWidth: '52px' }}>
                      {new Date(r.scheduled_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ width: '1px', height: '16px', background: PALETTE.border, margin: '0 12px', flexShrink: 0 }} />
                    <span style={{ fontSize: '14px', color: PALETTE.text }}>{r.brain_customer.name}様</span>
                    <span style={{ width: '1px', height: '16px', background: PALETTE.border, margin: '0 12px', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: PALETTE.text, flex: 1 }}>
                      {r.menu === '未定' ? 'メニュー未定' : r.menu}
                    </span>
                    <span style={{ width: '1px', height: '16px', background: PALETTE.border, margin: '0 12px', flexShrink: 0 }} />
                    <span style={{ fontSize: '12px', color: PALETTE.muted, whiteSpace: 'nowrap' }}>
                      担当 {r.staff_name ?? '-'}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid={`reschedule-${r.id}`}
                    onClick={() => { setRescheduleError(null); setRescheduleOverlap(false); setRescheduleTarget(r) }}
                    aria-label={`${r.brain_customer.name}様を別日に予約`}
                    style={{
                      flexShrink: 0, alignSelf: 'center', padding: '8px 14px', borderRadius: '999px',
                      border: `1px solid ${PALETTE.gold}`, background: 'transparent',
                      color: PALETTE.gold, fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    別日に予約
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCancelError(null); setCancelTarget(r) }}
                    aria-label={`${r.brain_customer.name}様の予約を変更`}
                    // 控えめなデザイン(2026-10-01): メインの「予約カードタップ(カルテ遷移)」より目立たせない。
                    // 小さく・枠/背景なし・stone-500相当の文字色。押下(タップ)中・ホバー中のみ赤系にする。
                    // 押し間違い防止のため、カードとの間隔(wrapperのgap)を広めに取っている。
                    onPointerEnter={e => { e.currentTarget.style.color = '#B85050' }}
                    onPointerLeave={e => { e.currentTarget.style.color = CANCEL_BUTTON_COLOR }}
                    onPointerDown={e => { e.currentTarget.style.color = '#B85050' }}
                    onPointerUp={e => { e.currentTarget.style.color = CANCEL_BUTTON_COLOR }}
                    onPointerCancel={e => { e.currentTarget.style.color = CANCEL_BUTTON_COLOR }}
                    style={{
                      flexShrink: 0, alignSelf: 'center',
                      padding: '6px 8px', borderRadius: '8px',
                      border: 'none', background: 'transparent',
                      color: CANCEL_BUTTON_COLOR, fontSize: '11px', fontWeight: 400, cursor: 'pointer',
                    }}
                  >
                    変更
                  </button>
                  </div>
                ))}
              </div>

              {/* 当日キャンセル欄(2026-10-01): キャンセル日時が本日(JST)の予約。0件のときは出さない。 */}
              {cancelledToday.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <button
                    type="button"
                    onClick={() => setCancelledOpen(v => !v)}
                    aria-expanded={cancelledOpen}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none',
                      padding: '4px 0', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: PALETTE.muted,
                    }}
                  >
                    {cancelledOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    変更（{cancelledToday.length}件）
                  </button>
                  {cancelledOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                      {cancelledToday.map(r => (
                        <div
                          key={r.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                            borderRadius: '12px', border: `1px dashed ${PALETTE.border}`,
                            background: 'rgba(0,0,0,0.02)', opacity: 0.85,
                          }}
                        >
                          <span style={{ fontSize: '14px', color: PALETTE.muted, fontWeight: 600, minWidth: '52px' }}>
                            {formatTimeJst(r.scheduled_at)}
                          </span>
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '14px', color: PALETTE.muted, textDecoration: 'line-through' }}>
                              {r.brain_customer.name}様
                            </span>
                            <span style={{ fontSize: '12px', color: PALETTE.muted }}>
                              {r.menu === '未定' ? 'メニュー未定' : r.menu}
                              {r.cancelled_at ? `　変更：${formatTimeJst(r.cancelled_at)}` : ''}
                            </span>
                          </div>
                          {r.cancel_source === 'manual' && (
                            <button
                              type="button"
                              onClick={() => { setCancelError(null); setRestoreTarget(r) }}
                              style={{
                                flexShrink: 0, padding: '8px 14px', borderRadius: '999px',
                                border: `1px solid ${PALETTE.gold}`, background: PALETTE.card,
                                color: PALETTE.gold, fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              変更取り消し
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {rescheduleTarget && (
        <ReservationRescheduleDialog
          customerName={rescheduleTarget.brain_customer.name}
          originalAt={rescheduleTarget.scheduled_at}
          menuName={rescheduleTarget.menu}
          busy={rescheduleBusy}
          error={rescheduleError}
          overlapWarning={rescheduleOverlap}
          onSubmit={input => { void runReschedule(input) }}
          onClose={closeRescheduleDialog}
        />
      )}

      {cancelTarget && (
        <ReservationCancelDialog
          title="予約変更"
          lines={[
            `${cancelTarget.brain_customer.name}様の予約を`,
            '変更にしますか？',
            `予約時間：${formatTimeJst(cancelTarget.scheduled_at)}`,
            `メニュー：${cancelTarget.menu === '未定' ? 'メニュー未定' : cancelTarget.menu}`,
          ]}
          confirmLabel="変更にする"
          busy={cancelBusy}
          error={cancelError}
          onConfirm={() => void runCancelAction('cancel')}
          onClose={closeCancelDialogs}
        />
      )}
      {restoreTarget && (
        <ReservationCancelDialog
          title="変更を取り消しますか？"
          lines={[
            `${restoreTarget.brain_customer.name}様の予約を通常の予約に戻します。`,
            `予約時間：${formatTimeJst(restoreTarget.scheduled_at)}`,
          ]}
          confirmLabel="変更を取り消す"
          busy={cancelBusy}
          error={cancelError}
          onConfirm={() => void runCancelAction('restore')}
          onClose={closeCancelDialogs}
        />
      )}

      {selected && (
        <CustomerTopPage
          customer={selected.customer}
          reservation={selected.reservation}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

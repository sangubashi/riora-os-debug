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
 * `/karte/[customerId]`へ直接遷移する」設計だったが、Phase1Screen.tsx/CustomersScreen.tsx
 * と同様に顧客トップページ(CustomerTopPage.tsx)を挟むよう修正した。CustomerTopPage内の
 * 「詳細ページを見る→」ボタンが`/karte/[customerId]`へのrouter.pushを担う(このファイル
 * 自体はrouter.pushを直接呼ばなくなった)。CustomerBottomSheetは既存通りimportしない
 * (CustomerTopPage内の「接客ログ/AI Timeline」ボタン経由でのみ間接的に開く)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Calendar } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { useHomeStore } from '@/store/useHomeStore'
import { useCustomerStore, type CustomerRow } from '@/store/useCustomerStore'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import CustomerTopPage from '@/components/customer/CustomerTopPage'
import type { ReservationWithBrainCustomer } from '@/types/database'
import type { Customer as BSCustomer, Reservation as BSReservation, CustomerType } from '@/types'

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

export default function KarteEntryScreen() {
  const session = useAuthStore(s => s.session)
  const [selected, setSelected] = useState<{ customer: BSCustomer; reservation?: BSReservation } | null>(null)
  const { reservations, isLoading: reservationsLoading, fetchTodayReservations } = useHomeStore()
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
    const q = query.trim().toLowerCase()
    if (!q) return []
    return customers.filter(c => c.name.toLowerCase().includes(q)).slice(0, 30)
  }, [customers, query])

  const openCustomerFromSearch = (c: CustomerRow) =>
    setSelected({ customer: toCustomerFromRow(c), reservation: toReservationFromRow(c) })
  const openCustomerFromReservation = (r: ReservationWithBrainCustomer) =>
    setSelected({ customer: toCustomerFromReservation(r), reservation: toReservationFromReservation(r) })

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
        <p
          style={{
            margin: 0, fontSize: '11px', letterSpacing: '0.15em', color: PALETTE.gold, textTransform: 'uppercase',
            justifySelf: 'end', paddingBottom: '4px', borderBottom: `1px solid ${PALETTE.gold}`,
          }}
        >
          KARTE
        </p>
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
                {filteredCustomers.map(c => (
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
                ))}
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
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openCustomerFromReservation(r)}
                    style={{
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
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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

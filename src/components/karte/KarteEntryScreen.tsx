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
 * 顧客をタップすると`/karte/[customerId]`へ遷移する(このコンポーネント自体は
 * CustomerBottomSheetを一切importしない)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Calendar } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { useHomeStore } from '@/store/useHomeStore'
import { useCustomerStore } from '@/store/useCustomerStore'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

export default function KarteEntryScreen() {
  const router = useRouter()
  const session = useAuthStore(s => s.session)
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

  const openCustomer = (customerId: string) => router.push(`/karte/${customerId}`)

  return (
    <div style={{ minHeight: '100dvh', background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flexShrink: 0,
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 32px 16px',
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <p style={{ margin: 0, fontSize: '22px', color: PALETTE.gold, letterSpacing: '0.01em', fontFamily: headingFont.style.fontFamily }}>
          Salon Riora
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '10px', letterSpacing: '0.2em', color: PALETTE.muted, textTransform: 'uppercase' }}>
          iPad カルテ
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
              placeholder="顧客名で検索"
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
                    onClick={() => openCustomer(c.id)}
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
              <p
                style={{
                  margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '13px', color: PALETTE.gold, letterSpacing: '0.04em',
                  fontFamily: headingFont.style.fontFamily,
                }}
              >
                <Calendar size={14} strokeWidth={1.8} />
                本日の予約
              </p>
              {reservationsLoading && <p style={{ fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>}
              {!reservationsLoading && reservations.length === 0 && (
                <p style={{ fontSize: '13px', color: PALETTE.muted }}>本日の予約はありません</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {reservations.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openCustomer(r.brain_customer_id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      textAlign: 'left', padding: '14px 16px', borderRadius: '12px',
                      border: `1px solid ${PALETTE.border}`, background: PALETTE.card, cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '14px', color: PALETTE.text }}>{r.brain_customer.name}様</span>
                    <span style={{ fontSize: '12px', color: PALETTE.muted }}>
                      {new Date(r.scheduled_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ・ {r.menu}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

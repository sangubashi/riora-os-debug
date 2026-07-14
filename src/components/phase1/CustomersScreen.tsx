'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Calendar } from 'lucide-react'
import Image from 'next/image'
import AppBottomNav from './AppBottomNav'
import { useCustomerStore, type CustomerRow, type CustomerType } from '@/store/useCustomerStore'
import { useAuthStore } from '@/store/useAuthStore'
import CustomerBottomSheet from '@/components/customer/CustomerBottomSheet'
import type { Customer, Reservation } from '@/types'

// ─── 定数 ────────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<CustomerType, string> = {
  'VIP型':       '#D4A96A',
  '慎重・不安型': '#9EB4D8',
  '感情重視型':   '#E88AAE',
  '効果重視型':   '#78C890',
  '信頼構築型':   '#D8A878',
}

function formatYen(n: number) {
  if (n >= 10_000) return `¥${(n / 10000).toFixed(1)}万`
  return `¥${n.toLocaleString('ja-JP')}`
}

// ─── CustomerBottomSheet 用マッパー ─────────────────────────────────────────────
// 顧客タブは実予約(reservations)を持たないため、CustomerRowから
// CustomerBottomSheetが要求するCustomer/Reservation型へ変換する。
// ロジックはPhase1Screen.tsxのtoCustomer()/toReservation()と同等の構造に揃えている。

function toCustomer(c: CustomerRow): Customer {
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

function toReservation(c: CustomerRow): Reservation {
  return {
    id:                    null,   // 顧客タブ起動時は実予約を持たない
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

// ─── メイン画面 ───────────────────────────────────────────────────────────────
// 検索・一覧のみのシンプル構成。スコア順・フェーズ順ソート、離脱危険ランキング、
// VIPバッジは評価系UIのため廃止（Riora OS v1.0 再設計書 準拠）。

// ─── 担当軸タブ(私のお客様/全顧客) ─────────────────────────────────────────────
// PHASE CUSTOMER-FILTER-PASS-C: /api/customers/list(Pass B)は既にAUTH-1 V2の
// アクセス可能顧客のみを返す(filterAccessibleCustomerIds)。この単一の取得結果を
// クライアント側でさらに絞り込むだけで、新たな担当判定・API呼び出しは追加しない。
// assignedStaffId は同APIが直近来店staff_id(Rule A')基準で既に算出済みのフィールド
// (CustomerRow.assignedStaffId)であり、これが設定されている行のみを「私のお客様」
// として扱う(Rule C: 来店・本日予約とも無い共有顧客はassignedStaffId=nullのため
// 「全顧客」タブでのみ表示される。CUSTOMER_FILTER_V2_DESIGN.md §3 に準拠)。
type OwnerScope = 'mine' | 'all'

export default function CustomersScreen() {
  const { customers, isLoading, fetchCustomers } = useCustomerStore()
  const { initialized: authInitialized } = useAuthStore()
  const [query,            setQuery]           = useState('')
  const [sortKey,          setSortKey]         = useState<'lastVisit' | 'sales'>('lastVisit')
  const [scope,            setScope]           = useState<OwnerScope>('mine')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)

  useEffect(() => {
    if (!authInitialized) return
    // service role API 経由のため session 不問で取得
    fetchCustomers()
  }, [authInitialized, fetchCustomers])

  const scoped = scope === 'mine'
    ? customers.filter(c => !!c.assignedStaffId)
    : customers

  const filtered = scoped.filter(c => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()

    if (c.name.toLowerCase().includes(q)) return true
    if (c.type.toLowerCase().includes(q)) return true
    if (c.staffName.toLowerCase().includes(q)) return true
    if (c.treatments.some(t => t.toLowerCase().includes(q))) return true

    return false
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'sales') return b.totalSpent - a.totalSpent
    return a.lastVisit - b.lastVisit
  })

  return (
    <div
      className="h-dvh flex flex-col overflow-hidden"
      style={{
        width: '100%',
        maxWidth: '430px',
        marginLeft: 'auto',
        marginRight: 'auto',
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      {/* ── ヘッダー ── */}
      <div
        className="flex-shrink-0 px-5"
        style={{
          paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 12px))',
          paddingBottom: '12px',
          background: 'rgba(253,247,248,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #F5E6E8',
        }}
      >
        <p className="text-[10px] font-medium tracking-[0.32em] mb-0.5" style={{ color: '#C8A8B0' }}>
          SALON RIORA
        </p>
        <h1 className="text-[24px] font-light leading-tight" style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}>Customers</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#9E8090' }}>
          {isLoading ? '読み込み中…' : `${scope === 'mine' ? '私のお客様' : '全顧客'} ${scoped.length}名`}
        </p>

        {/* 担当軸タブ: 私のお客様(デフォルト) / 全顧客 */}
        <div className="flex gap-2 mt-3">
          {([
            { key: 'mine', label: '私のお客様' },
            { key: 'all',  label: '全顧客' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              className="flex-1 text-center rounded-[12px] py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: scope === key ? 'linear-gradient(135deg, #F5A0B5, #F0879E)' : '#FFFFFF',
                color:      scope === key ? '#FFFFFF' : '#9E8090',
                border:     `1px solid ${scope === key ? 'transparent' : '#F0E8E8'}`,
                boxShadow:  scope === key ? '0 4px 14px rgba(240,135,158,0.28)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 検索 */}
        <div
          className="flex items-center gap-2 mt-3 rounded-[14px] px-3.5 py-2.5"
          style={{ background: '#FFFFFF', border: '1px solid #F5E6E8' }}
        >
          <Search size={15} style={{ color: '#C8A8B0', flexShrink: 0 }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="名前・タイプ・担当者・施術名で検索…"
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 16, color: '#4A2C2A' }}
          />
        </div>

        {/* ソートタブ */}
        <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'lastVisit', label: '来店日順' },
            { key: 'sales',     label: '売上順' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              style={{
                flexShrink: 0,
                fontSize: '11px',
                fontWeight: sortKey === key ? 700 : 400,
                padding: '4px 12px',
                borderRadius: '999px',
                border: `1px solid ${sortKey === key ? '#F56E8B' : '#F0E8E8'}`,
                background: sortKey === key ? 'rgba(245,110,139,0.08)' : 'transparent',
                color: sortKey === key ? '#F56E8B' : '#C8A8B0',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── リスト ── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(68px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        {/* スケルトン */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-[20px] border border-[#F5E6E8] h-[82px] animate-pulse"
                style={{ opacity: 1 - i * 0.1 }}
              />
            ))}
          </div>
        )}

        {/* カードリスト */}
        {!isLoading && sorted.map((c, i) => {
          const color = TYPE_COLOR[c.type]
          return (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedCustomer(c)}
              className="bg-white rounded-[20px] border border-[#F5E6E8] flex items-center gap-3 p-4 mb-3"
              style={{
                boxShadow: '0 2px 12px rgba(245,160,181,0.08)',
                cursor: 'pointer',
              }}
            >
              {/* アバター */}
              <div
                className="w-[52px] h-[52px] rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #FDF5F7, #F8EAF0)' }}
              >
                <Image
                  src="/assets/rio-kuma.png"
                  alt="くま"
                  width={46}
                  height={46}
                  className="object-contain"
                />
              </div>

              {/* 情報 */}
              <div className="flex-1 min-w-0">
                <span
                  className="text-[16px] font-semibold truncate block mb-0.5"
                  style={{ color: '#4A2C2A' }}
                >
                  {c.name} 様
                </span>
                <p className="text-[11px] font-medium mb-1" style={{ color }}>{c.type}</p>
                <div
                  className="flex items-center gap-3 text-[11px]"
                  style={{ color: '#9E8090' }}
                >
                  <span className="flex items-center gap-0.5">
                    <Calendar size={10} />{c.visitCount}回
                  </span>
                  <span>{formatYen(c.totalSpent)}</span>
                  <span>{c.lastVisit === 0 ? '本日' : `${c.lastVisit}日前`}</span>
                </div>
              </div>

              {/* 右矢印 */}
              <div style={{ color: '#D4B8BC', fontSize: 14, flexShrink: 0 }}>›</div>
            </motion.div>
          )
        })}

        {!isLoading && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Image
              src="/assets/rio-kuma.png"
              alt=""
              width={56}
              height={56}
              className="object-contain opacity-40"
            />
            <p className="text-[13px]" style={{ color: '#9E8090' }}>
              該当する顧客が見つかりません
            </p>
            {scope === 'mine' && customers.length > scoped.length && (
              <p className="text-[11px]" style={{ color: '#C8A8B0' }}>
                「全顧客」タブに切り替えると他の顧客も表示されます
              </p>
            )}
          </div>
        )}
      </div>

      <AppBottomNav />

      {/* ── 詳細シート（今日タブと同一のCustomerBottomSheetを使用） ── */}
      {selectedCustomer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <CustomerBottomSheet
            customer={toCustomer(selectedCustomer)}
            reservation={toReservation(selectedCustomer)}
            onClose={() => setSelectedCustomer(null)}
          />
        </div>
      )}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Calendar, MessageSquareText, X, Clock } from 'lucide-react'
import Image from 'next/image'
import AppBottomNav from './AppBottomNav'
import { useCustomerStore, type CustomerRow, type CustomerType } from '@/store/useCustomerStore'
import { useAuthStore } from '@/store/useAuthStore'
import CustomerBottomSheet from '@/components/customer/CustomerBottomSheet'
import { authedFetch } from '@/lib/api/authedFetch'
import type { Customer, Reservation } from '@/types'

// ─── 会話履歴検索（PHASE NOTES-SEARCH-1） ───────────────────────────────────────

type NoteSearchKind = 'conversation' | 'chart' | 'voice' | 'ai_summary'

interface NoteSearchResult {
  customerId:   string
  customerName: string
  kind:         NoteSearchKind
  matchedText:  string
  occurredAt:   string
}

const NOTE_SEARCH_KIND_LABEL: Record<NoteSearchKind, string> = {
  conversation: '会話メモ',
  chart:        'カルテメモ',
  voice:        '音声メモ',
  ai_summary:   'AI要約',
}

const RECENT_SEARCHES_KEY = 'riora_conversation_search_history'
const RECENT_SEARCHES_MAX = 5

function loadRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_SEARCHES_MAX) : []
  } catch { return [] }
}

function pushRecentSearch(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed || typeof window === 'undefined') return loadRecentSearches()
  const next = [trimmed, ...loadRecentSearches().filter(v => v !== trimmed)].slice(0, RECENT_SEARCHES_MAX)
  try { window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)) } catch { /* localStorageが使えない環境は無視 */ }
  return next
}

/** 検索文字だけを黄色でハイライトする(PHASE NOTES-SEARCH-1・要件④)。 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.trim().toLowerCase()
          ? <mark key={i} style={{ background: '#FFE066', color: '#4A2C2A', borderRadius: '3px', padding: '0 1px' }}>{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

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

  // ── 会話履歴検索（PHASE NOTES-SEARCH-1） ────────────────────────────────────
  const [noteQuery,         setNoteQuery]         = useState('')
  const [noteQueryFocused,  setNoteQueryFocused]  = useState(false)
  const [noteResults,       setNoteResults]       = useState<NoteSearchResult[]>([])
  const [noteSearchLoading, setNoteSearchLoading] = useState(false);
  const [recentSearches,    setRecentSearches]    = useState<string[]>([]);

  useEffect(() => {
    setRecentSearches(loadRecentSearches())
  }, [])

  // 入力と同時検索（要件①）。300ms debounceでAPI呼び出しを間引く。
  useEffect(() => {
    const trimmed = noteQuery.trim()
    if (trimmed.length < 2) {
      setNoteResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setNoteSearchLoading(true)
      try {
        const res = await authedFetch(`/api/customers/search-notes?q=${encodeURIComponent(trimmed)}`)
        if (res.ok) {
          const json = await res.json() as { success: boolean; results: NoteSearchResult[] }
          if (!cancelled && json.success) setNoteResults(json.results)
        }
      } finally {
        if (!cancelled) setNoteSearchLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [noteQuery])

  const handleNoteResultTap = (result: NoteSearchResult) => {
    pushRecentSearch(noteQuery)
    setRecentSearches(loadRecentSearches())
    const target = customers.find(c => c.id === result.customerId)
    if (target) setSelectedCustomer(target)
  }

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

  // 検索中は「顧客名自体が一致した行」を、担当者名・タイプ・施術名だけが一致した行より
  // 上位に表示する(例: 「鈴木」で検索した際、担当スタッフが鈴木さんというだけで
  // マッチした他の顧客の下に、顧客名が「鈴木」の本人が埋もれてしまうのを防ぐ)。
  const q = query.trim().toLowerCase()
  const sorted = [...filtered].sort((a, b) => {
    if (q) {
      const aNameMatch = a.name.toLowerCase().includes(q)
      const bNameMatch = b.name.toLowerCase().includes(q)
      if (aNameMatch !== bNameMatch) return aNameMatch ? -1 : 1
    }
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

        {/* 会話履歴検索（PHASE NOTES-SEARCH-1・要件①）: 会話メモ・音声メモ・AI要約・
            カルテメモを横断検索する。下の名前検索とは別の検索(検索対象が異なる)。 */}
        <div
          className="flex items-center gap-2 mt-3 rounded-[14px] px-3.5 py-2.5"
          style={{ background: '#FFF8F7', border: '1px solid #F5D9DF' }}
        >
          <MessageSquareText size={15} style={{ color: '#D98292', flexShrink: 0 }} />
          <input
            value={noteQuery}
            onChange={e => setNoteQuery(e.target.value)}
            onFocus={() => setNoteQueryFocused(true)}
            onBlur={() => setTimeout(() => setNoteQueryFocused(false), 150)}
            placeholder="会話メモ・音声メモ・AI要約を検索…"
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 16, color: '#4A2C2A' }}
          />
          {noteQuery && (
            <button onClick={() => setNoteQuery('')} className="flex-shrink-0" aria-label="クリア">
              <X size={14} style={{ color: '#C8A8B0' }} />
            </button>
          )}
        </div>

        {/* 最近の検索（要件⑤・localStorageのみ・入力欄フォーカス時かつ未入力時のみ表示） */}
        {noteQueryFocused && !noteQuery.trim() && recentSearches.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <Clock size={11} style={{ color: '#C8A8B0', flexShrink: 0 }} />
            {recentSearches.map(term => (
              <button
                key={term}
                onMouseDown={() => setNoteQuery(term)}
                className="text-[11px] px-2.5 py-1 rounded-full"
                style={{ background: '#FFFFFF', border: '1px solid #F0E8E8', color: '#9E8090' }}
              >
                {term}
              </button>
            ))}
          </div>
        )}

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
        {/* 会話履歴検索結果（PHASE NOTES-SEARCH-1・要件③④）: 2文字以上入力中は
            通常の顧客一覧の代わりにこちらを表示する。 */}
        {noteQuery.trim().length >= 2 ? (
          <>
            {noteSearchLoading && (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-[20px] border border-[#F5E6E8] h-[74px] animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
                ))}
              </div>
            )}
            {!noteSearchLoading && noteResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Image src="/assets/rio-kuma.png" alt="" width={56} height={56} className="object-contain opacity-40" />
                <p className="text-[13px]" style={{ color: '#9E8090' }}>会話メモ・音声メモが見つかりません</p>
              </div>
            )}
            {!noteSearchLoading && noteResults.map((r, i) => (
              <motion.div
                key={`${r.customerId}-${r.kind}-${r.occurredAt}-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleNoteResultTap(r)}
                className="bg-white rounded-[20px] border border-[#F5E6E8] p-4 mb-3"
                style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)', cursor: 'pointer' }}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[14px] font-semibold truncate" style={{ color: '#4A2C2A' }}>{r.customerName} 様</span>
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: '#FFF0F5', color: '#D98292' }}
                  >
                    {NOTE_SEARCH_KIND_LABEL[r.kind]}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed mb-1.5" style={{ color: '#5C4033' }}>
                  <HighlightedText text={r.matchedText} query={noteQuery} />
                </p>
                <p className="text-[11px]" style={{ color: '#C8A8B0' }}>
                  {new Date(r.occurredAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </motion.div>
            ))}
          </>
        ) : (
          <>
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
          </>
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

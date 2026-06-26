'use client'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Star, TrendingDown, Calendar, X, Wallet, Clock } from 'lucide-react'
import Image from 'next/image'
import AppBottomNav from './AppBottomNav'
import { useCustomerStore, type CustomerRow, type CustomerType } from '@/store/useCustomerStore'
import { useAuthStore } from '@/store/useAuthStore'
import { DEMO_MODE } from '@/lib/supabase'
import { calcCustomerPhase, calcCustomerScore } from '@/lib/phase5/customerRiskEngine'
import { CUSTOMER_PHASE_LABEL, CUSTOMER_PHASE_COLOR } from '@/types'
import ChurnRiskRanking from './ChurnRiskRanking'

// ─── 定数 ────────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<CustomerType, string> = {
  'VIP型':       '#D4A96A',
  '慎重・不安型': '#9EB4D8',
  '感情重視型':   '#E88AAE',
  '効果重視型':   '#78C890',
  '信頼構築型':   '#D8A878',
}

const TYPE_BG: Record<CustomerType, string> = {
  'VIP型':       'rgba(212,169,106,0.12)',
  '慎重・不安型': 'rgba(158,180,216,0.12)',
  '感情重視型':   'rgba(232,138,174,0.12)',
  '効果重視型':   'rgba(120,200,144,0.12)',
  '信頼構築型':   'rgba(216,168,120,0.12)',
}

function formatYen(n: number) {
  if (n >= 10_000) return `¥${(n / 10000).toFixed(1)}万`
  return `¥${n.toLocaleString('ja-JP')}`
}

// ─── 詳細シート ───────────────────────────────────────────────────────────────

function CustomerDetailSheet({
  customer,
  onClose,
}: {
  customer: CustomerRow | null
  onClose: () => void
}) {
  const c = customer
  if (!c) return null

  const color    = TYPE_COLOR[c.type]
  const typeBg   = TYPE_BG[c.type]
  const isDanger = c.churnRisk > 60

  return (
    <AnimatePresence>
      {c && (
        <>
          {/* バックドロップ：完全不透明で裏の文字を遮断 */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(40, 20, 18, 0.62)',
              zIndex: 200,
              touchAction: 'none',
            }}
          />

          {/* シート：transform競合を避けるため left/right/margin でセンタリング */}
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340, mass: 0.9 }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              maxWidth: '430px',
              marginLeft: 'auto',
              marginRight: 'auto',
              background: '#FFFFFF',
              borderRadius: '24px 24px 0 0',
              zIndex: 201,
              paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
              boxShadow: '0 -12px 48px rgba(92,64,51,0.18)',
              overflowY: 'auto',
              minHeight: '74vh',
              maxHeight: '88vh',
            }}
          >
            {/* ドラッグハンドル */}
            <div className="flex justify-center pt-3 pb-1">
              <div style={{ width: 36, height: 4, borderRadius: 9, background: '#F0E0E4' }} />
            </div>

            {/* 閉じるボタン */}
            <button
              onClick={onClose}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#F8EFF0',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={15} color="#9E8090" />
            </button>

            <div className="px-6 pt-2 pb-4">

              {/* ── ヘッダー ── */}
              <div className="flex items-center gap-3 mb-5">
                {/* アバター */}
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #FDF5F7, #F8EAF0)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '2px solid #F5E6E8',
                  }}
                >
                  <Image
                    src="/assets/rio-kuma.png"
                    alt="くま"
                    width={52}
                    height={52}
                    className="object-contain"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[20px] font-semibold truncate"
                      style={{ color: '#4A2C2A' }}
                    >
                      {c.name} 様
                    </span>
                    {c.isVip && (
                      <span
                        className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white flex items-center gap-0.5"
                        style={{ background: 'linear-gradient(135deg, #E8C88A, #D4A96A)' }}
                      >
                        <Star size={7} fill="currentColor" />VIP
                      </span>
                    )}
                  </div>
                  {/* 顧客タイプ */}
                  <span
                    className="inline-block mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                    style={{ color, background: typeBg }}
                  >
                    {c.type}
                  </span>
                </div>
              </div>

              {/* ── KPI グリッド ── */}
              <div
                className="grid grid-cols-3 gap-2 mb-4"
              >
                {[
                  {
                    icon: <Calendar size={14} color="#C8A8B0" />,
                    label: '来店回数',
                    value: `${c.visitCount}回`,
                    color: '#4A2C2A',
                  },
                  {
                    icon: <Wallet size={14} color="#C8A8B0" />,
                    label: '累計売上',
                    value: formatYen(c.totalSpent),
                    color: '#4A2C2A',
                  },
                  {
                    icon: <Clock size={14} color="#C8A8B0" />,
                    label: '最終来店',
                    value: c.lastVisitDate
                      ? c.lastVisit === 0 ? '本日' : `${c.lastVisit}日前`
                      : '未来店',
                    color: c.lastVisit > 60 ? '#E84050' : '#4A2C2A',
                  },
                ].map(({ icon, label, value, color: valColor }) => (
                  <div
                    key={label}
                    className="rounded-[16px] p-3 flex flex-col items-center gap-1"
                    style={{ background: '#FDF7F8', border: '1px solid #F5E6E8' }}
                  >
                    {icon}
                    <span
                      className="text-[15px] font-bold tabular-nums"
                      style={{ color: valColor, fontFamily: 'Inter, sans-serif' }}
                    >
                      {value}
                    </span>
                    <span className="text-[9px]" style={{ color: '#B09090' }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* ── 失客リスク ── */}
              <div
                className="rounded-[16px] p-4"
                style={{ background: isDanger ? 'rgba(232,64,80,0.05)' : '#FDF7F8', border: `1px solid ${isDanger ? 'rgba(232,64,80,0.15)' : '#F5E6E8'}` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <TrendingDown size={13} color={isDanger ? '#E84050' : '#C8A8B0'} />
                    <span className="text-[11px] font-medium" style={{ color: '#9E8090' }}>失客リスク</span>
                  </div>
                  <span
                    className="text-[14px] font-bold tabular-nums"
                    style={{ color: isDanger ? '#E84050' : '#52C87A', fontFamily: 'Inter, sans-serif' }}
                  >
                    {c.churnRisk}%
                  </span>
                </div>
                {/* リスクバー */}
                <div
                  className="rounded-full overflow-hidden"
                  style={{ height: 6, background: '#F0E0E4' }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${c.churnRisk}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: isDanger
                        ? 'linear-gradient(90deg, #F5A0B5, #E84050)'
                        : 'linear-gradient(90deg, #A8E6C8, #52C87A)',
                      borderRadius: 9,
                    }}
                  />
                </div>
                {isDanger && (
                  <p className="text-[10px] mt-1.5" style={{ color: '#E84050' }}>
                    ⚠ 来店間隔が空いています。フォローを検討してください。
                  </p>
                )}
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── メイン画面 ───────────────────────────────────────────────────────────────

export default function CustomersScreen() {
  const { customers, isLoading, fetchCustomers, debug } = useCustomerStore()
  const { initialized: authInitialized, session } = useAuthStore()
  const [query,            setQuery]           = useState('')
  const [sortKey,          setSortKey]         = useState<'lastVisit' | 'score' | 'phase' | 'sales'>('lastVisit')
  const [phaseFilter,      setPhaseFilter]     = useState<string>('all')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)

  useEffect(() => {
    if (!authInitialized) return
    // DEMO_MODE: 認証完了後にセッション有無に関わらず実行（失敗時はMOCKにフォールバック）
    if (DEMO_MODE || session) {
      fetchCustomers()
    }
  }, [authInitialized, session, fetchCustomers])

  const PHASE_ORDER: Record<string, number> = { risk: 0, vip: 1, repeat: 2, growing: 3, new: 4 }

  const filtered = customers.filter(c => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()

    // 顧客名
    if (c.name.toLowerCase().includes(q)) return true

    // 顧客タイプ
    if (c.type.toLowerCase().includes(q)) return true

    // 担当者名
    if (c.staffName.toLowerCase().includes(q)) return true

    // 施術名
    if (c.treatments.some(t => t.toLowerCase().includes(q))) return true

    // CustomerPhase キー・日本語ラベル
    const phase = calcCustomerPhase({
      visits:               c.visitCount,
      totalSales:           c.totalSpent,
      vipRank:              c.isVip ? 3 : 0,
      churnRisk:            c.churnRisk,
      daysSinceLastVisit:   c.lastVisit,
      recommendedCycleDays: 30,
    })
    if (phase.toLowerCase().includes(q)) return true
    if (CUSTOMER_PHASE_LABEL[phase].includes(q)) return true

    return false
  }).filter(c => {
    // フェーズフィルタータブ（AND 条件）
    if (phaseFilter === 'all') return true
    const phase = calcCustomerPhase({
      visits:               c.visitCount,
      totalSales:           c.totalSpent,
      vipRank:              c.isVip ? 3 : 0,
      churnRisk:            c.churnRisk,
      daysSinceLastVisit:   c.lastVisit,
      recommendedCycleDays: 30,
    })
    return phase === phaseFilter
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'lastVisit') return a.lastVisit - b.lastVisit
    if (sortKey === 'sales')     return b.totalSpent - a.totalSpent
    if (sortKey === 'score' || sortKey === 'phase') {
      const scoreA = calcCustomerScore({
        visits: a.visitCount, totalSales: a.totalSpent,
        avgPrice: a.visitCount > 0 ? Math.round(a.totalSpent / a.visitCount) : 0,
        lineResponseRate: 50, vipRank: a.isVip ? 3 : 0, churnRisk: a.churnRisk,
      }).total
      const scoreB = calcCustomerScore({
        visits: b.visitCount, totalSales: b.totalSpent,
        avgPrice: b.visitCount > 0 ? Math.round(b.totalSpent / b.visitCount) : 0,
        lineResponseRate: 50, vipRank: b.isVip ? 3 : 0, churnRisk: b.churnRisk,
      }).total
      if (sortKey === 'score') return scoreB - scoreA
      // phase: フェーズ優先順 → 同フェーズ内はスコア降順
      const phaseA = calcCustomerPhase({
        visits: a.visitCount, totalSales: a.totalSpent, vipRank: a.isVip ? 3 : 0,
        churnRisk: a.churnRisk, daysSinceLastVisit: a.lastVisit, recommendedCycleDays: 30,
      })
      const phaseB = calcCustomerPhase({
        visits: b.visitCount, totalSales: b.totalSpent, vipRank: b.isVip ? 3 : 0,
        churnRisk: b.churnRisk, daysSinceLastVisit: b.lastVisit, recommendedCycleDays: 30,
      })
      const po = (PHASE_ORDER[phaseA] ?? 9) - (PHASE_ORDER[phaseB] ?? 9)
      return po !== 0 ? po : scoreB - scoreA
    }
    return 0
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
        <h1 className="text-[22px] font-semibold" style={{ color: '#4A2C2A' }}>顧客一覧</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#9E8090' }}>
          {isLoading ? '読み込み中…' : `${customers.length}名登録`}
        </p>

        {/* ── デバッグパネル ── */}
        <div
          className="mt-2 rounded-[10px] px-3 py-2 text-[10px] font-mono space-y-0.5"
          style={{ background: '#1e1e2e', color: '#cdd6f4' }}
        >
          <div><span style={{ color: '#89b4fa' }}>session:</span> {debug.hasSession ? '✓ あり' : '✗ なし'}</div>
          <div><span style={{ color: '#89b4fa' }}>auth.uid:</span> {debug.authUid ?? '未ログイン'}</div>
          <div><span style={{ color: '#89b4fa' }}>role:</span> {debug.role ?? 'null'}</div>
          <div><span style={{ color: '#89b4fa' }}>customers:</span> {debug.rawCount}件取得 / {customers.length}件表示</div>
          <div>
            <span style={{ color: '#89b4fa' }}>RPC集計:</span>{' '}
            <span style={{ color: debug.statsCount > 0 ? '#a6e3a1' : '#f38ba8' }}>
              {debug.statsCount > 0 ? `✓ ${debug.statsCount}顧客` : '✗ 0件'}
            </span>
          </div>
          {debug.rpcError && (
            <div style={{ color: '#f38ba8' }}>rpcError: {debug.rpcError}</div>
          )}
          {debug.errorMsg && (
            <div style={{ color: '#f38ba8' }}>error: {debug.errorMsg}</div>
          )}
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
            placeholder="名前・フェーズ・担当者・施術名で検索…"
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 16, color: '#4A2C2A' }}
          />
        </div>

        {/* フェーズフィルター */}
        <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'all',     label: 'すべて',   color: '#9F7E6C' },
            { key: 'risk',    label: '離脱危険', color: '#EF476F' },
            { key: 'vip',     label: 'VIP',      color: '#D4A017' },
            { key: 'repeat',  label: 'リピーター', color: '#52B788' },
            { key: 'growing', label: '育成',     color: '#74C69D' },
            { key: 'new',     label: '新規',     color: '#6C757D' },
          ] as const).map(({ key, label, color }) => {
            const active = phaseFilter === key
            return (
              <button key={key} onClick={() => setPhaseFilter(key)}
                style={{
                  flexShrink: 0,
                  fontSize: '11px',
                  fontWeight: active ? 700 : 400,
                  padding: '4px 12px',
                  borderRadius: '999px',
                  border: `1px solid ${active ? color : '#F0E8E8'}`,
                  background: active ? color + '22' : 'transparent',
                  color: active ? color : '#C8A8B0',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* ソートタブ */}
        <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'lastVisit', label: '来店日順' },
            { key: 'score',     label: 'スコア順' },
            { key: 'phase',     label: 'フェーズ順' },
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

        {/* 離脱危険ランキング（フィルター・検索なしの全件表示時のみ） */}
        {!query && phaseFilter === 'all' && <ChurnRiskRanking />}

        {/* カードリスト */}
        {!isLoading && sorted.map((c, i) => {
          const color    = TYPE_COLOR[c.type]
          const isDanger = c.churnRisk > 60

          // Phase / Score を CustomerRow から計算
          const phase = calcCustomerPhase({
            visits:               c.visitCount,
            totalSales:           c.totalSpent,
            vipRank:              c.isVip ? 3 : 0,
            churnRisk:            c.churnRisk,
            daysSinceLastVisit:   c.lastVisit,
            recommendedCycleDays: 30,
          })
          const score = calcCustomerScore({
            visits:           c.visitCount,
            totalSales:       c.totalSpent,
            avgPrice:         c.visitCount > 0 ? Math.round(c.totalSpent / c.visitCount) : 0,
            lineResponseRate: 50,
            vipRank:          c.isVip ? 3 : 0,
            churnRisk:        c.churnRisk,
          }).total
          const phaseColor = CUSTOMER_PHASE_COLOR[phase]
          const phaseLabel = CUSTOMER_PHASE_LABEL[phase]
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
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-[16px] font-semibold truncate"
                    style={{ color: '#4A2C2A' }}
                  >
                    {c.name} 様
                  </span>
                  {c.isVip && (
                    <span
                      className="flex-shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-white flex items-center gap-0.5"
                      style={{ background: 'linear-gradient(135deg, #E8C88A, #D4A96A)' }}
                    >
                      <Star size={6} fill="currentColor" />VIP
                    </span>
                  )}
                </div>
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

              {/* Phase バッジ + スコア */}
              <div className="flex-shrink-0 flex flex-col items-end gap-1">
                <span style={{
                  fontSize: '9px', fontWeight: 700, padding: '2px 7px',
                  borderRadius: '999px',
                  background: phaseColor + '22',
                  color: phaseColor,
                  border: `1px solid ${phaseColor}44`,
                  whiteSpace: 'nowrap',
                }}>
                  {phaseLabel}
                </span>
                <span style={{
                  fontSize: '11px', fontWeight: 700, color: phaseColor,
                  fontFamily: 'Inter, sans-serif',
                }}>
                  {score}<span style={{ fontSize: '9px', fontWeight: 400, color: '#C8A8B0' }}>pt</span>
                </span>
              </div>

              {/* リスク */}
              {isDanger && (
                <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                  <TrendingDown size={14} style={{ color: '#E84050' }} />
                  <span
                    className="text-[10px] font-bold tabular-nums"
                    style={{ color: '#E84050' }}
                  >
                    {c.churnRisk}%
                  </span>
                </div>
              )}

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
          </div>
        )}
      </div>

      <AppBottomNav />

      {/* ── 詳細シート ── */}
      <CustomerDetailSheet
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
      />
    </div>
  )
}

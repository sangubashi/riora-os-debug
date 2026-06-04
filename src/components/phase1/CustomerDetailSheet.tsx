'use client'
/**
 * CustomerDetailSheet — スクリーンショット 2026-05-15 180810.png 完全準拠
 *
 * レイアウト:
 *   ヘッダー  : [くまアバター] [顧客名 VIPバッジ] ─── [✕]
 *   統計 3つ  : 来店回数 / 総売上 / LINE反応率
 *   コンテンツ: 今日の接客ポイント heading + くまマスコット(右)
 *              今日の狙い / おすすめの提案 / おすすめオプション
 *              NGワード / 次回誘導タイミング
 *   フッター  : [接客ログを記録する] ボタン
 */
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Star, Pencil, Check } from 'lucide-react'
import type { Phase1Reservation, CustomerType } from './ReservationCard'

// ─── タイプ別 AI アドバイス ───────────────────────────────────────────────────
const ADVICE: Record<CustomerType, {
  aim:    string
  menu:   string
  option: string
  ng:     string
  timing: string
}> = {
  'VIP型': {
    aim:    '特別感を演出し、他では得られない体験を提供',
    menu:   'プレミアムエイジングケア（90分）',
    option: '美白トリートメント or コラーゲンパック',
    ng:     '一般化表現・他のお客様事例の多用',
    timing: '施術終了15分前に次回予約をご提案',
  },
  '慎重・不安型': {
    aim:    '安心感を与えて信頼を深める',
    menu:   '水光肌フェイシャル（保湿中心）',
    option: '水素導入＋ヘッドスパ',
    ng:     '強い言葉・値引き訴求',
    timing: '3〜4週間後が最適',
  },
  '感情重視型': {
    aim:    '感情的なつながりと共感で接客',
    menu:   'リラクゼーションコース',
    option: 'ヘッドスパ（リラックス効果高）',
    ng:     '事務的・数値的な表現',
    timing: '感謝の言葉と共に次回をご提案',
  },
  '効果重視型': {
    aim:    '具体的な変化・数値で次回予約につなげる',
    menu:   'ポアクリーニング＋美白ケア',
    option: '美白トリートメント（効果訴求）',
    ng:     '「個人差があります」の多用',
    timing: '施術結果を見せながら次回ご提案',
  },
  '信頼構築型': {
    aim:    '定期来店の習慣化を丁寧に促進',
    menu:   'ベーシックフェイシャル',
    option: 'デコルテマッサージ（リラックス系）',
    ng:     '「今日だけの特別価格」などの圧力表現',
    timing: '次回の来店目安をさりげなくお伝え',
  },
}

const ADVICE_ROWS = [
  { key: 'aim',    label: '今日の狙い',        color: '#F5A0B5' },
  { key: 'menu',   label: 'おすすめの提案',     color: '#D4A96A' },
  { key: 'option', label: 'おすすめオプション', color: '#78C890' },
  { key: 'ng',     label: 'NGワード',          color: '#E84050' },
  { key: 'timing', label: '次回誘導タイミング', color: '#9EB4D8' },
] as const

function formatYen(n: number) {
  if (n >= 1_000_000) return `¥${(n / 10000).toFixed(0)}万`
  if (n >= 10_000)    return `¥${(n / 10000).toFixed(1)}万`
  return `¥${n.toLocaleString('ja-JP')}`
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface Props {
  reservation:  Phase1Reservation | null
  isOpen:       boolean
  lineRate?:    number
  onClose:      () => void
  onServiceLog: (r: Phase1Reservation) => void
}

export default function CustomerDetailSheet({
  reservation: r,
  isOpen,
  lineRate = 72,
  onClose,
  onServiceLog,
}: Props) {
  const [savedMemo,   setSavedMemo]   = useState('')
  const [draftMemo,   setDraftMemo]   = useState('')
  const [editingMemo, setEditingMemo] = useState(false)

  // 顧客が切り替わったらメモをリセット
  useEffect(() => {
    setSavedMemo('')
    setDraftMemo('')
    setEditingMemo(false)
  }, [r?.id])

  if (!r) return null
  const advice = ADVICE[r.customerType] ?? ADVICE['信頼構築型']

  const stats = [
    { label: '来店回数',  value: `${r.visitCount}`,       unit: '回'   },
    { label: '総売上',    value: formatYen(r.totalSpent),  unit: ''     },
    { label: 'LINE反応率', value: `${lineRate}`,           unit: '%'    },
  ]

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── オーバーレイ ── */}
          <motion.div
            key="detail-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.24)', backdropFilter: 'blur(6px)' }}
          />

          {/* ── Bottom Sheet ── */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="detail-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 34, stiffness: 320 }}
              className="w-full max-w-[430px] pointer-events-auto rounded-t-[28px] flex flex-col overflow-x-hidden"
              style={{
                maxHeight: '88dvh',
                background: '#FFFFFF',
                boxShadow: '0 -4px 32px rgba(245,160,181,0.18), 0 -1px 6px rgba(74,44,42,0.06)',
              }}
            >

              {/* ─ ヘッダー ─ */}
              <div className="flex items-center gap-3 px-5 pt-5 pb-3 flex-shrink-0">
                {/* くまアバター */}
                <div
                  className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #FDF5F7, #F8EAF0)' }}
                >
                  <Image src="/assets/rio-kuma.png" alt="くま" width={40} height={40} className="object-contain" />
                </div>

                {/* 顧客名 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[18px] font-semibold text-salon-brown">{r.customerName} 様</h2>
                    {r.isVip && (
                      <span
                        className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white inline-flex items-center gap-0.5 flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #E8C88A, #D4A96A)' }}
                      >
                        <Star size={7} fill="currentColor" />VIP
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-salon-brown-sub mt-0.5 truncate">{r.menu}</p>
                </div>

                {/* ✕ 閉じるボタン */}
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: '#F5E6E8' }}
                >
                  <X size={14} className="text-salon-brown-sub" />
                </button>
              </div>

              {/* ─ 3統計チップ ─ */}
              <div className="flex gap-2 px-5 pb-4 flex-shrink-0">
                {stats.map(s => (
                  <div
                    key={s.label}
                    className="flex-1 rounded-[14px] py-2.5 flex flex-col items-center border border-[#F5E6E8]"
                    style={{ background: '#FDFAF9' }}
                  >
                    <span className="text-[15px] font-semibold tabular-nums text-salon-brown leading-tight">
                      {s.value}<span className="text-[11px]">{s.unit}</span>
                    </span>
                    <span className="text-[9px] text-salon-brown-sub mt-0.5">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* ─ スクロールエリア ─ */}
              <div
                className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar px-5"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {/* 接客ポイント heading + くまマスコット */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-semibold tracking-[0.18em] text-salon-pink mb-0.5">AI ADVICE</p>
                    <p className="text-[14px] font-semibold text-salon-brown">今日の接客ポイント</p>
                  </div>
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-[62px] h-[62px] rounded-full flex items-center justify-center flex-shrink-0 ml-2"
                    style={{ background: 'linear-gradient(135deg, #FFF0F5, #FCEEF7)', boxShadow: '0 4px 14px rgba(245,160,181,0.22)' }}
                  >
                    <Image src="/assets/rio-kuma.png" alt="AI" width={50} height={50} className="object-contain" />
                  </motion.div>
                </div>

                {/* アドバイス行 */}
                <div className="flex flex-col divide-y divide-[#F5E6E8]">
                  {ADVICE_ROWS.map(row => (
                    <div key={row.key} className="py-3">
                      <p
                        className="text-[9px] font-bold tracking-[0.16em] mb-1"
                        style={{ color: row.color }}
                      >
                        {row.label}
                      </p>
                      <p
                        className="text-[13px] text-salon-brown leading-relaxed"
                        style={{ color: row.key === 'ng' ? '#E84050' : '#4A2C2A' }}
                      >
                        {advice[row.key]}
                      </p>
                    </div>
                  ))}
                </div>

                {/* ── 接客メモ ── */}
                <div
                  className="mt-4 rounded-[16px] border border-[#F5E6E8] overflow-hidden"
                  style={{ background: '#FDFAF9' }}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#F5E6E8]">
                    <p className="text-[12px] font-semibold text-salon-brown">📝 接客メモ</p>
                    <button
                      onClick={() => {
                        if (!editingMemo) setDraftMemo(savedMemo)
                        setEditingMemo(v => !v)
                      }}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: '#F5E6E8' }}
                    >
                      {editingMemo
                        ? <Check size={13} style={{ color: '#52C87A' }} />
                        : <Pencil size={13} className="text-salon-brown-sub" />}
                    </button>
                  </div>
                  <div className="px-4 py-3">
                    {editingMemo ? (
                      <div>
                        <textarea
                          value={draftMemo}
                          onChange={e => setDraftMemo(e.target.value)}
                          placeholder="接客メモを入力…"
                          rows={3}
                          autoFocus
                          className="w-full text-salon-brown bg-transparent resize-none outline-none leading-relaxed"
                          style={{ fontFamily: 'inherit', fontSize: '16px' }}
                        />
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={() => {
                              if (draftMemo.trim()) setSavedMemo(draftMemo.trim())
                              setEditingMemo(false)
                            }}
                            className="px-4 py-1.5 rounded-full text-[12px] font-medium text-white"
                            style={{ background: 'linear-gradient(135deg, #F5A0B5, #F0879E)' }}
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[13px] text-salon-brown leading-relaxed whitespace-pre-wrap min-h-[20px]">
                        {savedMemo || <span className="text-salon-brown-light text-[12px]">メモなし（鉛筆アイコンで追加）</span>}
                      </p>
                    )}
                  </div>
                </div>

                <div className="h-4" />
              </div>

              {/* ─ 接客ログを記録するボタン ─ */}
              <div
                className="flex-shrink-0 w-full px-5 pt-3"
                style={{
                  paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
                  background: 'rgba(255,255,255,0.98)',
                  borderTop: '1px solid #F5E6E8',
                }}
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { onClose(); onServiceLog(r) }}
                  className="w-full py-4 rounded-full text-white text-[15px] font-semibold"
                  style={{
                    background: 'linear-gradient(135deg, #5A3840, #4A2C2A)',
                    boxShadow: '0 4px 14px rgba(74,44,42,0.30)',
                  }}
                >
                  接客ログを記録する
                </motion.button>
              </div>

            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

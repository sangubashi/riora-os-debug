'use client'
import { useRef } from 'react'
/**
 * ReservationCard — QVTE6013.PNG 完全再現
 *
 * レイアウト:
 *   [サングラスくま] | [名前 VIPバッジ] [タグ列]
 *                    | [顧客タイプ]     [▼]
 *                    | [来店N回 · N日前]
 */
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ChevronDown, AlertTriangle } from 'lucide-react'

// ─── 型定義 ──────────────────────────────────────────────────────────────────
export type CustomerType =
  | 'VIP型' | '慎重・不安型' | '感情重視型' | '効果重視型' | '信頼構築型'

export interface Phase1Reservation {
  id:                 string   // 予約ID
  customerId:         string   // 顧客ID（customer_action_logs 等で使用）
  scheduledAt:        string
  durationMinutes:    number
  menu:               string
  customerName:       string
  customerType:       CustomerType
  visitCount:         number
  totalSpent:         number
  aiScore:            number
  isVip:              boolean
  churnRisk:          number
  daysSinceLastVisit: number
  lineTags?:          string[]
}

// ─── タイプ別カラー ───────────────────────────────────────────────────────────
const TYPE_COLOR: Record<CustomerType, string> = {
  'VIP型':       '#D4A96A',
  '慎重・不安型': '#9EB4D8',
  '感情重視型':   '#E88AAE',
  '効果重視型':   '#78C890',
  '信頼構築型':   '#D8A878',
}

function formatTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }) }
  catch { return iso.slice(11,16) }
}

// ─── コンポーネント ───────────────────────────────────────────────────────────
interface Props {
  reservation:  Phase1Reservation
  index:        number
  onTap:        (r: Phase1Reservation) => void
  /** 長押しで統合版 BottomSheet を開く（既存 onTap と完全に別導線） */
  onLongPress?: (r: Phase1Reservation) => void
}

export default function ReservationCard({ reservation: r, index, onTap, onLongPress }: Props) {
  const color    = TYPE_COLOR[r.customerType]
  const isDanger = r.churnRisk > 65 || r.daysSinceLastVisit >= 60
  const tags     = r.lineTags ?? defaultTags(r.customerType)

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handlePressStart() {
    if (!onLongPress) return
    pressTimer.current = setTimeout(() => { onLongPress(r) }, 600)
  }
  function handlePressEnd() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.985 }}
      onClick={() => onTap(r)}
      onPointerDown={handlePressStart}
      onPointerUp={handlePressEnd}
      onPointerLeave={handlePressEnd}
      className="text-left mx-4 mb-3 block"
      style={{ width: 'calc(100% - 2rem)' }}
    >
      <div
        className="bg-white rounded-[20px] border border-[#F5E6E8] flex items-start gap-3 p-4"
        style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.10), 0 1px 3px rgba(74,44,42,0.04)' }}
      >
        {/* ─── サングラスくま（左） ─── */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1">
          <div
            className="w-[56px] h-[56px] rounded-full overflow-hidden flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #FDF5F7 0%, #F8EAF0 100%)' }}
          >
            <Image
              src="/assets/rio-kuma.png"
              alt="サロンくま"
              width={52}
              height={52}
              className="object-contain"
            />
          </div>
          {/* 予約時間 */}
          <span className="text-[11px] font-semibold text-salon-brown-sub tabular-nums">
            {formatTime(r.scheduledAt)}
          </span>
        </div>

        {/* ─── 中央：顧客情報 ─── */}
        <div className="flex-1 min-w-0 pt-0.5">
          {/* 名前 + VIPバッジ */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[17px] font-semibold text-salon-brown leading-tight truncate">
              {r.customerName}
            </span>
            {r.isVip && (
              <span
                className="flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full text-white"
                style={{ background: 'linear-gradient(135deg, #E8C88A 0%, #D4A96A 100%)' }}
              >
                VIP
              </span>
            )}
            {isDanger && (
              <AlertTriangle size={13} className="flex-shrink-0 text-salon-danger" />
            )}
          </div>

          {/* 顧客タイプ */}
          <p className="text-[12px] font-medium mb-1" style={{ color }}>
            {r.customerType}
          </p>

          {/* 来店回数 · 日数 */}
          <p className="text-[12px] text-salon-brown-sub">
            来店{r.visitCount}回
            <span className="mx-1.5 opacity-40">·</span>
            {r.daysSinceLastVisit}日前
          </p>
        </div>

        {/* ─── 右：タグ + シェブロン ─── */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
          {tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: '#F8EEF1', color: '#9E7890' }}
            >
              {tag}
            </span>
          ))}
          <ChevronDown size={14} className="text-salon-brown-light mt-0.5" />
        </div>
      </div>
    </motion.button>
  )
}

function defaultTags(type: CustomerType): string[] {
  const map: Record<CustomerType, string[]> = {
    'VIP型':       ['#エイジング', '#プレミアム'],
    '慎重・不安型': ['#毛穴',      '#たるみ'],
    '感情重視型':   ['#保湿',      '#リラックス'],
    '効果重視型':   ['#美白',      '#ハリ'],
    '信頼構築型':   ['#定期',      '#ケア'],
  }
  return map[type]
}

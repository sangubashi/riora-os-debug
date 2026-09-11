'use client'
/**
 * PhotoCompareKit.tsx — お客様モード(CustomerModeView)から抽出した共有UI部品(PHASE IPAD-1)。
 *
 * 2026-09-11: 「アイボリー×ベージュ×ゴールド×ダークブラウン」デザインの写真比較UIを、
 * お客様モードとiPad専用スタッフカルテ画面(IpadStaffKarteView)の両方で使えるように
 * CustomerModeView.tsxから移動しただけ(ロジック・見た目は無変更)。
 */
import { type ReactNode, type ComponentType } from 'react'
import { Shippori_Mincho } from 'next/font/google'
import {
  Flower2,
  Maximize2,
  Droplet,
  Sparkles,
  CircleDot,
  Waves,
  CloudFog,
  ImageOff,
  type LucideProps,
} from 'lucide-react'

// 見出し・タブ・カードタイトル用: 上品な明朝体。本文の数値・説明文は可読性優先でシステム標準のまま。
export const headingFont = Shippori_Mincho({ subsets: ['latin'], weight: '600', display: 'swap' })

export const PALETTE = {
  bg: '#F7F2EA',
  card: '#FFFFFF',
  border: '#E8DFCF',
  gold: '#AD8A54',
  text: '#3E3226',
  muted: '#8A7A65',
  shadow: '0 4px 24px rgba(60,45,25,0.06)',
}

/** 肌状態タグの線画アイコン対応(絵文字・色ベタ塗りドットの代替、PHASE GUEST-MODE-1-DESIGN)。
 *  未知のラベルはSparklesにフォールバックする。 */
export const SKIN_TAG_ICONS: Record<string, ComponentType<LucideProps>> = {
  '乾燥': Droplet,
  '毛穴': CircleDot,
  '赤み': Flower2,
  'ハリ': Sparkles,
  'ニキビ': CircleDot,
  'たるみ': Waves,
  'くすみ': CloudFog,
}

export interface SkinTagChip {
  label: string
  color: string
}

/** "2026-08-21"や完全なISO日時のどちらでも「8月21日」形式に整形する(表示専用の軽量ヘルパー)。 */
export function formatVisitDateLabel(dateStr: string | null): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function PhotoPanel({
  label, url, visitCountAt, visitDate, emptyText, onExpand,
}: {
  label: string
  url: string | undefined
  visitCountAt: number | null
  visitDate: string | null
  emptyText: string
  onExpand?: () => void
}) {
  const dateLabel = formatVisitDateLabel(visitDate)
  const captionParts = [
    visitCountAt != null ? `来店${visitCountAt}回目` : null,
    dateLabel,
  ].filter(Boolean)

  return (
    <div>
      <div
        style={{
          position: 'relative', aspectRatio: '5 / 4', borderRadius: '16px', overflow: 'hidden',
          background: '#EFE8DA',
          border: url ? `1px solid ${PALETTE.border}` : `1.5px dashed ${PALETTE.border}`,
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`${label}の写真`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px',
              alignItems: 'center', justifyContent: 'center',
              color: PALETTE.muted, fontSize: '12px', textAlign: 'center', padding: '16px',
            }}
          >
            <ImageOff size={26} strokeWidth={1.3} color={PALETTE.gold} />
            {emptyText}
          </div>
        )}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label={`${label}の写真を拡大`}
            style={{
              position: 'absolute', bottom: '12px', right: '12px',
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.92)', border: 'none', color: PALETTE.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <Maximize2 size={15} strokeWidth={1.6} />
          </button>
        )}
      </div>
      {captionParts.length > 0 && (
        <p style={{ textAlign: 'center', margin: '10px 0 0', fontSize: '12px', color: PALETTE.muted }}>
          {captionParts.join(' ・ ')}
        </p>
      )}
    </div>
  )
}

export function SkinTagRow({ tags }: { tags: SkinTagChip[] }) {
  if (tags.length === 0) return <div />
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
      {tags.map(tag => {
        const Icon = SKIN_TAG_ICONS[tag.label] ?? Sparkles
        return (
          <span
            key={tag.label}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              fontSize: '12px', fontWeight: 600, color: PALETTE.text, letterSpacing: '0.02em',
              background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
              borderRadius: '999px', padding: '6px 15px',
            }}
          >
            <Icon size={13} strokeWidth={1.6} color={tag.color} />
            {tag.label}
          </span>
        )
      })}
    </div>
  )
}

export function InfoBarItem({
  icon: Icon, label, value,
}: { icon: ComponentType<LucideProps>; label: string; value: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 20px' }}>
      <span
        style={{
          width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
          background: PALETTE.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon size={16} strokeWidth={1.4} color={PALETTE.gold} />
      </span>
      <div>
        <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.1em', color: PALETTE.muted }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>{value}</p>
      </div>
    </div>
  )
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '18px',
        padding: '18px 20px', boxShadow: PALETTE.shadow,
      }}
    >
      <p
        style={{
          margin: '0 0 14px', fontSize: '13px', letterSpacing: '0.08em', color: PALETTE.gold,
          fontFamily: headingFont.style.fontFamily,
        }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

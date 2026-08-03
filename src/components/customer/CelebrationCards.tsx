'use client'
/**
 * CelebrationCards.tsx — 祝福・気遣いカード(AI Timeline内)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §3-1(誕生日)・
 * §3-3(記念日)準拠。誕生日・記念日は全文テンプレート＋パターン切替＋
 * LINEコピーボタンを持つ。それ以外(ホームケア等)は見出し＋一言の簡易表示のみ。
 * スコア・ランク・VIP・数字競争は表示しない(事実・祝福・気遣いのみ)。
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import type { CelebrationCard } from '@/lib/notifications/generateCard'

interface CardsResponse {
  success: boolean
  cards:   CelebrationCard[]
  error?:  string
}

const CARD_STYLE: Record<CelebrationCard['kind'], { bg: string; border: string; accent: string }> = {
  birthday:             { bg: '#FFF8F2', border: '#F0D8C0', accent: '#C07030' },
  anniversary_visit:    { bg: '#FDF5F7', border: '#F5D8E0', accent: '#B06080' },
  wedding:              { bg: '#FDF5F7', border: '#F5D8E0', accent: '#B06080' },
  homecare_usage_guide: { bg: '#F0F8F4', border: '#D0E8DC', accent: '#30806A' },
  homecare_checkin:     { bg: '#F0F8F4', border: '#D0E8DC', accent: '#30806A' },
  homecare_replenish:   { bg: '#F0F8F4', border: '#D0E8DC', accent: '#30806A' },
}

/** 誕生日・記念日カードの全文テンプレート表示＋パターン切替＋LINEコピー。 */
function FullTextCard({ card, accent }: { card: CelebrationCard; accent: string }) {
  const [pattern, setPattern] = useState<'A' | 'B'>('A')
  const [copied, setCopied]   = useState(false)

  if (!card.fullText) return null
  const text = pattern === 'B' && card.fullText.patternB ? card.fullText.patternB : card.fullText.patternA

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードAPI非対応環境では何もしない(テキストは画面上に表示済みなので手動選択は可能)
    }
  }

  return (
    <div style={{ marginTop: '10px' }}>
      {card.fullText.patternB && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          {(['A', 'B'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPattern(p)}
              style={{
                fontSize: '11px',
                padding: '3px 10px',
                borderRadius: '99px',
                border: `1px solid ${pattern === p ? accent : '#EEE1D8'}`,
                background: pattern === p ? accent : '#fff',
                color: pattern === p ? '#fff' : '#9F7E6C',
                cursor: 'pointer',
              }}
            >
              パターン{p}
            </button>
          ))}
        </div>
      )}
      <pre
        style={{
          fontFamily: 'inherit',
          fontSize: '12px',
          color: '#5C4033',
          lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
          background: '#fff',
          borderRadius: '10px',
          padding: '10px 12px',
          border: '1px solid #F0E8DC',
          margin: 0,
        }}
      >
        {text}
      </pre>
      <button
        onClick={handleCopy}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          marginTop: '6px', fontSize: '11px', fontWeight: 700,
          padding: '5px 12px', borderRadius: '99px', border: 'none',
          background: copied ? '#30806A' : accent, color: '#fff', cursor: 'pointer',
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  )
}

interface Props {
  customerId: string
}

export default function CelebrationCards({ customerId }: Props) {
  const [cards, setCards]     = useState<CelebrationCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authedFetch(`/api/customers/${customerId}/celebration-cards`)
      .then((res) => res.json())
      .then((data: CardsResponse) => {
        if (!cancelled && data.success) setCards(data.cards)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [customerId])

  if (loading || cards.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {cards.map((card, i) => {
        const style = CARD_STYLE[card.kind]
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            style={{
              background: style.bg,
              border: `1px solid ${style.border}`,
              borderRadius: '16px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '18px', lineHeight: 1.4, flexShrink: 0 }}>{card.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', lineHeight: 1.5 }}>
                  {card.headline}
                </p>
                <p style={{ fontSize: '12px', color: style.accent, marginTop: '2px', lineHeight: 1.5 }}>
                  → {card.suggestion}
                </p>
              </div>
            </div>
            {card.fullText && <FullTextCard card={card} accent={style.accent} />}
          </motion.div>
        )
      })}
    </div>
  )
}

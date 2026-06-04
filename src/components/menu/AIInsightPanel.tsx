'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, TrendingUp, AlertTriangle, Zap, ChevronDown } from 'lucide-react'
import { useMenuStore } from '@/store/useMenuStore'

type InsightItem = {
  id:     string
  Icon:   typeof Sparkles
  color:  string
  label:  string
  title:  string
  body:   string
}

export default function AIInsightPanel() {
  const { menus } = useMenuStore()
  const [expanded, setExpanded] = useState(false)

  const topMenu     = menus.filter(m => m.isActive).sort((a, b) => b.vipConversionRate - a.vipConversionRate)[0]
  const declineMenu = menus.filter(m => m.isActive && m.trend === 'down')[0]
  const bestUpsell  = menus.filter(m => m.isActive).sort((a, b) => b.upsellSuccessRate - a.upsellSuccessRate)[0]

  const insights: InsightItem[] = [
    {
      id: '1', Icon: TrendingUp, color: '#C49A6B', label: 'VIP移行',
      title: `${topMenu?.name ?? '—'} がVIP移行を牽引`,
      body:  `VIP移行率 ${topMenu?.vipConversionRate ?? 0}%。このメニューを体験した顧客の${topMenu?.vipConversionRate ?? 0}%がプレミアム施術へアップグレードしています。積極的な提案を継続してください。`,
    },
    {
      id: '2', Icon: Zap, color: '#EA91A6', label: 'アップセル',
      title: `${bestUpsell?.name ?? '—'} オプション提案タイミング`,
      body:  `施術後20分のタイミングでのオプション提案成功率が ${bestUpsell?.upsellSuccessRate ?? 0}% と最高水準。このメニュー施術時は必ずオプションをご案内ください。`,
    },
    {
      id: '3', Icon: AlertTriangle, color: '#F87171', label: '注意',
      title: `${declineMenu?.name ?? 'メニュー'}のリピート率が低下中`,
      body:  `${declineMenu?.name ?? 'このメニュー'}のリピート率が先月比 -6pt。お客様へのカウンセリング内容と、次回予約提案のタイミングを見直すことを推奨します。`,
    },
    {
      id: '4', Icon: Sparkles, color: '#B09ACE', label: '推奨',
      title: 'サブスク転換の最適タイミング',
      body:  '3回以上ご来店のお客様で、まだサブスクに入っていない方が18名。次回来店時にプレミアムサブスクをご案内すると転換率が高い傾向があります。',
    },
  ]

  const visible = expanded ? insights : insights.slice(0, 2)

  return (
    <div className="mx-4 mb-5">
      <div
        className="rounded-3xl p-4 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(234,145,166,0.07) 0%, rgba(255,255,255,0.60) 50%, rgba(196,154,107,0.05) 100%)',
          border: '1px solid rgba(234,145,166,0.18)',
          boxShadow: '0 8px 24px rgba(232,145,166,0.08)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(234,145,166,0.15)' }}
            >
              <Sparkles size={12} style={{ color: '#EA91A6' }} />
            </div>
            <span className="text-[10px] tracking-[0.25em] font-medium" style={{ color: '#9A7E74' }}>
              AI MENU INSIGHTS
            </span>
          </div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[10px]"
            style={{ color: '#EA91A6' }}
          >
            {expanded ? '閉じる' : '全て見る'}
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={11} />
            </motion.span>
          </button>
        </div>

        {/* Insight items */}
        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {visible.map((item, i) => {
              const Icon = item.Icon
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.22 }}
                  className="rounded-2xl p-3"
                  style={{
                    background: 'rgba(255,255,255,0.60)',
                    border: '1px solid rgba(243,227,230,0.80)',
                    boxShadow: '0 2px 8px rgba(232,145,166,0.06)',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex-shrink-0">
                      <Icon size={13} strokeWidth={2} style={{ color: item.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                          className="text-[9px] font-semibold tracking-widest"
                          style={{ color: item.color }}
                        >
                          {item.label}
                        </span>
                      </div>
                      <p className="text-[12px] font-medium leading-snug" style={{ color: '#5C4033' }}>{item.title}</p>
                      <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: '#9A7E74' }}>{item.body}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

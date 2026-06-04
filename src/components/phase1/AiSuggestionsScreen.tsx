'use client'
import { motion } from 'framer-motion'
import { Sparkles, AlertTriangle } from 'lucide-react'
import Image from 'next/image'
import AppBottomNav from './AppBottomNav'
import { buildSuggestion } from '@/engine/ruleBasedSuggestion'
import type { AiTagRow } from '@/types/database'

// ─── 顧客タイプ別タグ定義（DBから取得するまでの静的マッピング） ───────────────
type CustomerType = 'VIP型' | '感情重視型' | '効果重視型' | '慎重・不安型' | '信頼構築型'

const TYPE_TAGS: Record<CustomerType, Partial<AiTagRow>> = {
  'VIP型':       { vip: true,          repeat_high: true  },
  '感情重視型':   { repeat_high: true   },
  '効果重視型':   { uv_sensitive: true, dry_skin: false    },
  '慎重・不安型': { dry_skin: true,     sales_hate: true   },
  '信頼構築型':   { repeat_high: true,  sales_hate: false  },
}

const TYPE_COLOR: Record<CustomerType, { text: string; bg: string; border: string }> = {
  'VIP型':       { text: '#D4A96A', bg: '#FFFAF0', border: '#E8C88A40' },
  '感情重視型':   { text: '#E88AAE', bg: '#FFF5F8', border: '#F5B8D040' },
  '効果重視型':   { text: '#78C890', bg: '#F5FBF7', border: '#78C89040' },
  '慎重・不安型': { text: '#9EB4D8', bg: '#F5F8FD', border: '#9EB4D840' },
  '信頼構築型':   { text: '#D8A878', bg: '#FFFDF5', border: '#D8A87840' },
}

// 各タイプのサンプル顧客プロフィール（DBに接続するまでのフォールバック）
const TYPE_PROFILES: Record<CustomerType, { name: string; visit_count: number; last_visit_date: string; churn_risk_score: number }> = {
  'VIP型':       { name: 'VIP様',   visit_count: 12, last_visit_date: new Date(Date.now() - 14 * 86400000).toISOString(), churn_risk_score: 10 },
  '感情重視型':   { name: 'お客様',  visit_count: 5,  last_visit_date: new Date(Date.now() - 30 * 86400000).toISOString(), churn_risk_score: 25 },
  '効果重視型':   { name: 'お客様',  visit_count: 8,  last_visit_date: new Date(Date.now() - 20 * 86400000).toISOString(), churn_risk_score: 15 },
  '慎重・不安型': { name: 'お客様',  visit_count: 3,  last_visit_date: new Date(Date.now() - 45 * 86400000).toISOString(), churn_risk_score: 55 },
  '信頼構築型':   { name: 'お客様',  visit_count: 6,  last_visit_date: new Date(Date.now() - 28 * 86400000).toISOString(), churn_risk_score: 20 },
}

const CUSTOMER_TYPES = Object.keys(TYPE_TAGS) as CustomerType[]

export default function AiSuggestionsScreen() {
  return (
    <div
      className="h-dvh flex flex-col"
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
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold" style={{ color: '#4A2C2A' }}>AI 提案</h1>
          <Sparkles size={18} style={{ color: '#F5A0B5' }} />
        </div>
        <p className="text-[11px] mt-0.5" style={{ color: '#9E8090' }}>
          DBタグ × ルールベースで生成 · AI全文生成なし
        </p>
      </div>

      {/* ── コンテンツ ── */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{
          scrollbarWidth: 'none',
          paddingBottom: 'calc(88px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        {/* くまバナー */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-[20px] border border-[#F5E6E8] p-4 mb-4 bg-white"
          style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.10)' }}
        >
          <Image src="/assets/rio-kuma.png" alt="AI" width={52} height={52} className="object-contain flex-shrink-0" />
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] mb-1" style={{ color: '#F5A0B5' }}>
              RULE-BASED AI
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: '#4A2C2A' }}>
              DBに保存された接客タグから、顧客タイプ別の接客ガイドを生成しています。
            </p>
          </div>
        </motion.div>

        {/* タイプ別カード */}
        {CUSTOMER_TYPES.map((type, i) => {
          const tags = TYPE_TAGS[type]
          const profile = TYPE_PROFILES[type]
          const suggestion = buildSuggestion(tags, profile)
          const color = TYPE_COLOR[type]

          return (
            <motion.div
              key={type}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.07 }}
              className="rounded-[20px] border p-4 mb-3"
              style={{
                background: color.bg,
                borderColor: color.border,
                boxShadow: `0 2px 10px ${color.text}14`,
              }}
            >
              {/* タイプラベル */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[10px] font-bold px-2.5 py-1 rounded-full text-white"
                  style={{ background: color.text }}
                >
                  {type}
                </span>
                {suggestion.menuRecommendation && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${color.text}18`, color: color.text }}>
                    推奨: {suggestion.menuRecommendation}
                  </span>
                )}
              </div>

              {/* 4ステップ提案 */}
              <div className="flex flex-col gap-2.5">
                {[
                  { step: '① 共感',   text: suggestion.empathy   },
                  { step: '② 個別感', text: suggestion.personal  },
                  { step: '③ 提案',   text: suggestion.proposal  },
                  { step: '④ クロージング', text: suggestion.closing },
                ].map(row => (
                  <div key={row.step}>
                    <p className="text-[9px] font-bold tracking-[0.2em] mb-0.5" style={{ color: color.text }}>
                      {row.step}
                    </p>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#4A2C2A' }}>{row.text}</p>
                  </div>
                ))}

                {/* 注意事項 */}
                {suggestion.caution && (
                  <div
                    className="flex items-start gap-2 rounded-xl px-3 py-2 mt-1"
                    style={{ background: '#FFF0F2', border: '1px solid #FFCDD2' }}
                  >
                    <AlertTriangle size={12} className="text-rose-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-rose-600 leading-snug">{suggestion.caution}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>

      <AppBottomNav />
    </div>
  )
}

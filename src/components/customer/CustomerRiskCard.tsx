'use client'
/**
 * CustomerRiskCard.tsx  — PHASE 5
 * BottomSheet の「今日の接客ポイント」直下に差し込む接客予兆パネル。
 *
 * ── 絶対ルール ──
 * UIデザイン変更禁止。既存 BottomSheet スタイルを完全踏襲。
 * 数値を直接見せない。自然言語で状態を表現。
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  buildRiskProfile,
  buildRelationshipState,
  fetchRiskEngineContext,
  type RiskEngineInput,
} from '@/lib/phase5/customerRiskEngine'
import {
  generateSmartFollowDraft,
  type SmartFollowInput,
} from '@/lib/phase5/smartFollowDraft'
import {
  buildPredictiveSuggestions,
} from '@/lib/phase5/predictiveSuggestions'
import { getMenuCycleDays } from '@/lib/homecare/generateHomecarePlan'
import { fetchRetrievalSuggestions } from '@/lib/phase8/successPatternEngine'
import { semanticInsightSummary } from '@/lib/phase8/kpiHintEngine'
import type {
  CustomerRiskProfile, RelationshipState, PredictiveSuggestion, RetrievalSuggestion,
  SkinTagKey,
} from '@/types'
import {
  RELATIONSHIP_LABEL, RELATIONSHIP_EMOJI,
} from '@/types'
import type { SmartFollowDraft } from '@/lib/phase5/smartFollowDraft'

// ─── Props ────────────────────────────────────────────────────────────────────

interface CustomerRiskCardProps {
  customerId:           string
  customerName:         string
  visits:               number
  totalSales:           number
  lineResponseRate:     number
  vipRank:              number
  churnRisk:            number
  daysSinceLastVisit:   number
  skinTags:             SkinTagKey[]
  menuName:             string
  avgPrice:             number
  recommendedCycleDays?: number | null
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export default function CustomerRiskCard(props: CustomerRiskCardProps) {
  const {
    customerId, customerName, visits, totalSales,
    lineResponseRate, vipRank, churnRisk, daysSinceLastVisit,
    skinTags, menuName, avgPrice, recommendedCycleDays,
  } = props

  const cycleDays = recommendedCycleDays ?? getMenuCycleDays(menuName)

  const [loading,       setLoading]       = useState(true)
  const [risk,          setRisk]          = useState<CustomerRiskProfile | null>(null)
  const [relationship,  setRelationship]  = useState<RelationshipState | null>(null)
  const [followDraft,   setFollowDraft]   = useState<SmartFollowDraft | null>(null)
  const [predictive,    setPredictive]    = useState<PredictiveSuggestion[]>([])
  const [showDraft,     setShowDraft]     = useState(false)
  const [retrievals,    setRetrievals]    = useState<RetrievalSuggestion[]>([])
  const [semanticHint,  setSemanticHint]  = useState<string>('')
  const [draftCopied,   setDraftCopied]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const ctx = await fetchRiskEngineContext(customerId)

    const ruleInput: RiskEngineInput = {
      customerId, visits, totalSales, lineResponseRate, vipRank,
      churnRisk, daysSinceLastVisit, recommendedCycleDays: cycleDays,
      avgPrice,
      ...ctx,
    }

    const riskProfile  = buildRiskProfile(ruleInput)
    const relState     = buildRelationshipState(ruleInput)

    const followInput: SmartFollowInput = {
      customerName, daysSinceLastVisit, recommendedCycleDays: cycleDays,
      relationshipState: relState, skinTags,
      insightTags: ctx.insightTags, menuName, lineResponseRate,
    }
    const draft = generateSmartFollowDraft(followInput)

    const pred = buildPredictiveSuggestions({
      customerId, visits, daysSinceLastVisit, recommendedCycleDays: cycleDays,
      insightTags: ctx.insightTags, skinTags, lineResponseRate,
      hasRecentPurchase: ctx.hasRecentPurchase,
      vipRank, recentActionTypes: ctx.recentActionTypes,
    })

    setRisk(riskProfile)
    setRelationship(relState)
    setFollowDraft(draft)
    setPredictive(pred)

    // PHASE8: Retrieval Suggestion + Semantic Summary（並列・fallback）
    const [retriResult] = await Promise.allSettled([
      fetchRetrievalSuggestions({
        customerType:       ctx.insightTags.join(','),
        menuName,
        daysSinceLastVisit,
        churnRisk,
        visits,
      }),
    ])
    if (retriResult.status === 'fulfilled') setRetrievals(retriResult.value)

    // Semantic Summary
    const semantic = semanticInsightSummary(ctx.insightTags, skinTags as string[])
    setSemanticHint(semantic)

    setLoading(false)
  }, [customerId, visits, totalSales, lineResponseRate, vipRank, churnRisk, daysSinceLastVisit, cycleDays, avgPrice, customerName, skinTags, menuName]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const copyDraft = useCallback(async () => {
    if (!followDraft?.draft) return
    try {
      await navigator.clipboard.writeText(followDraft.draft)
      setDraftCopied(true)
      toast.success('LINE下書きをコピーしました', { duration: 1500 })
      setTimeout(() => setDraftCopied(false), 2500)
    } catch { toast.error('コピーに失敗しました') }
  }, [followDraft])

  // ── ローディング ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ background: '#FFF8F7', borderRadius: '22px', padding: '16px', border: '1px solid #F5E6E8' }}>
        <div style={{ height: '11px', width: '70px', borderRadius: '6px', background: '#F5EDEE', marginBottom: '10px' }} />
        <div style={{ height: '13px', width: '90%', borderRadius: '6px', background: '#F5EDEE', marginBottom: '6px' }} />
        <div style={{ height: '11px', width: '60%', borderRadius: '6px', background: '#F5EDEE' }} />
      </div>
    )
  }

  if (!risk || !relationship) return null

  // ── 表示色（relationship） ───────────────────────────────────────────────
  const relColors: Record<RelationshipState, { text: string; bg: string; border: string }> = {
    forming:  { text: '#A07020', bg: '#FFFBF0', border: 'rgba(160,112,32,0.2)' },
    growing:  { text: '#207850', bg: '#F0FAF5', border: 'rgba(32,120,80,0.2)'  },
    stable:   { text: '#34A070', bg: '#F0FAF7', border: 'rgba(52,160,112,0.2)' },
    cooling:  { text: '#A07020', bg: '#FFFBF0', border: 'rgba(160,112,32,0.25)'},
    at_risk:  { text: '#C05060', bg: '#FFF0F2', border: 'rgba(192,80,96,0.2)'  },
  }
  const rc = relColors[relationship]

  // ── リスク色 ─────────────────────────────────────────────────────────────
  const riskLevelColor = {
    high:   { text: '#C05060', bg: '#FFF0F2' },
    medium: { text: '#A07020', bg: '#FFFBF0' },
    low:    { text: '#34A070', bg: '#F0FAF7' },
  }

  return (
    <div style={{ background: '#FFF8F7', borderRadius: '22px', padding: '16px', border: '1px solid #F5E6E8', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── ヘッダー：関係性ステート ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#C8A58C', fontWeight: 600 }}>
          🔮 接客コンテキスト
        </p>
        <span style={{
          fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
          background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
        }}>
          {RELATIONSHIP_EMOJI[relationship]} {RELATIONSHIP_LABEL[relationship]}
        </span>
      </div>

      {/* ── リスクサマリー（数値なし・自然言語） ── */}
      {(risk.riskFactors.length > 0 || risk.positiveFactors.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {risk.positiveFactors.slice(0, 2).map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px' }}>
              <span style={{ fontSize: '12px', flexShrink: 0, marginTop: '1px' }}>✅</span>
              <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.55 }}>{f}</p>
            </div>
          ))}
          {risk.riskFactors.slice(0, 2).map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px' }}>
              <span style={{ fontSize: '12px', flexShrink: 0, marginTop: '1px' }}>⚡</span>
              <p style={{ fontSize: '12px', color: '#9F7E6C', lineHeight: 1.55 }}>{f}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── 提案成功率ヒント ── */}
      {risk.offerSuccessRate !== 'low' && (
        <div style={{
          background: riskLevelColor[risk.offerSuccessRate].bg,
          borderRadius: '12px', padding: '9px 12px',
          border: `1px solid rgba(200,165,140,0.15)`,
        }}>
          <p style={{ fontSize: '12px', color: riskLevelColor[risk.offerSuccessRate].text, lineHeight: 1.6 }}>
            {risk.offerSuccessRate === 'high'
              ? '💎 今日は提案が刺さりやすい状態です'
              : '💡 提案は自然な流れで入れると効果的です'}
          </p>
        </div>
      )}

      {/* ── Smart Follow Draft ── */}
      {followDraft && (
        <div style={{ background: '#F0FAF5', borderRadius: '16px', border: '1px solid rgba(52,160,112,0.2)', overflow: 'hidden' }}>
          <button
            onClick={() => setShowDraft(v => !v)}
            style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <div>
              <p style={{ fontSize: '11px', letterSpacing: '0.14em', color: '#34A070', fontWeight: 600 }}>💬 フォローLINE下書き</p>
              <p style={{ fontSize: '10px', color: '#9F7E6C', marginTop: '2px' }}>{followDraft.sendTiming} · {followDraft.tone}</p>
            </div>
            <span style={{ fontSize: '13px', color: '#34A070', transform: showDraft ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s', display: 'inline-block' }}>▾</span>
          </button>

          <AnimatePresence>
            {showDraft && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ padding: '0 14px 12px' }}>
                  {/* 理由説明 */}
                  <p style={{ fontSize: '10px', color: '#9F7E6C', marginBottom: '8px', lineHeight: 1.5 }}>
                    📌 {followDraft.reason}
                  </p>
                  {/* 本文 */}
                  <div style={{ background: '#fff', borderRadius: '12px', padding: '11px', border: '1px solid rgba(52,160,112,0.15)', marginBottom: '8px' }}>
                    <p style={{ fontSize: '13px', color: '#3C5C45', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'Noto Sans JP, sans-serif' }}>
                      {followDraft.draft}
                    </p>
                  </div>
                  {/* コピーボタン */}
                  <button onClick={copyDraft}
                    style={{ width: '100%', padding: '9px', borderRadius: '999px', border: `1px solid ${draftCopied ? 'rgba(52,160,112,0.4)' : 'rgba(52,160,112,0.25)'}`, background: draftCopied ? 'rgba(52,160,112,0.12)' : 'rgba(52,160,112,0.06)', color: '#34A070', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', transition: 'all 0.18s' }}>
                    {draftCopied ? '✓ コピー済み' : '📋 テキストをコピー'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Predictive Suggestions ── */}
      {predictive.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#C8A58C', fontWeight: 600 }}>🔭 今後必要になりそうなこと</p>
          {predictive.map((pred, i) => (
            <motion.div key={pred.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{ background: '#fff', borderRadius: '14px', padding: '10px 13px', border: '1px solid #F0E8E8' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '9px', padding: '1px 7px', borderRadius: '999px', background: pred.horizon === 'soon' ? '#FFF0F2' : '#F8F5F0', color: pred.horizon === 'soon' ? '#C05060' : '#A08060', border: `1px solid ${pred.horizon === 'soon' ? 'rgba(192,80,96,0.2)' : 'rgba(160,128,96,0.2)'}`, fontWeight: 600, letterSpacing: '0.06em' }}>
                  {pred.horizon === 'soon' ? '近日' : '来月'}
                </span>
                <p style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033' }}>{pred.title}</p>
              </div>
              <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>{pred.description}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── PHASE8: Semantic Summary ── */}
      {semanticHint && (
        <div style={{ background: 'rgba(200,165,140,0.06)', borderRadius: '14px', padding: '10px 13px', border: '1px solid rgba(200,165,140,0.15)' }}>
          <p style={{ fontSize: '10px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '4px' }}>💡 状況の読み取り</p>
          <p style={{ fontSize: '12px', color: '#9F7E6C', lineHeight: 1.65 }}>{semanticHint}</p>
        </div>
      )}

      {/* ── PHASE8: Retrieval Suggestions ── */}
      {retrievals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#C8A58C', fontWeight: 600 }}>📚 成功パターンの参照</p>
          {retrievals.slice(0, 2).map((r, i) => (
            <motion.div key={r.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              style={{ background: '#fff', borderRadius: '14px', padding: '10px 13px', border: '1px solid #F0E8E8' }}
            >
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033', marginBottom: '4px' }}>{r.title}</p>
              <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6, marginBottom: '4px' }}>{r.description}</p>
              <p style={{ fontSize: '10px', color: '#C8A8B0' }}>{r.basedOn}</p>
            </motion.div>
          ))}
        </div>
      )}

    </div>
  )
}

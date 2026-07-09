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
import { getMenuCycleDays } from '@/lib/homecare/generateHomecarePlan'
import { semanticInsightSummary } from '@/lib/phase8/kpiHintEngine'
import type {
  CustomerRiskProfile, RelationshipState,
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
  const [showDraft,     setShowDraft]     = useState(false)
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

    setRisk(riskProfile)
    setRelationship(relState)
    setFollowDraft(draft)

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

      {/* ── PHASE8: Semantic Summary ── */}
      {semanticHint && (
        <div style={{ background: 'rgba(200,165,140,0.06)', borderRadius: '14px', padding: '10px 13px', border: '1px solid rgba(200,165,140,0.15)' }}>
          <p style={{ fontSize: '10px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '4px' }}>💡 状況の読み取り</p>
          <p style={{ fontSize: '12px', color: '#9F7E6C', lineHeight: 1.65 }}>{semanticHint}</p>
        </div>
      )}

    </div>
  )
}

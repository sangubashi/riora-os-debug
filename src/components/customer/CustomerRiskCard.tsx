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
import {
  buildRiskProfile,
  buildRelationshipState,
  fetchRiskEngineContext,
  type RiskEngineInput,
} from '@/lib/phase5/customerRiskEngine'
import { getMenuCycleDays } from '@/lib/homecare/generateHomecarePlan'
import { semanticInsightSummary } from '@/lib/phase8/kpiHintEngine'
import type {
  CustomerRiskProfile, RelationshipState,
  SkinTagKey,
} from '@/types'
import {
  RELATIONSHIP_LABEL, RELATIONSHIP_EMOJI,
} from '@/types'

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
    customerId, visits, totalSales,
    lineResponseRate, vipRank, churnRisk, daysSinceLastVisit,
    skinTags, menuName, avgPrice, recommendedCycleDays,
  } = props

  const cycleDays = recommendedCycleDays ?? getMenuCycleDays(menuName)

  const [loading,       setLoading]       = useState(true)
  const [risk,          setRisk]          = useState<CustomerRiskProfile | null>(null)
  const [relationship,  setRelationship]  = useState<RelationshipState | null>(null)
  const [semanticHint,  setSemanticHint]  = useState<string>('')

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

    setRisk(riskProfile)
    setRelationship(relState)

    // Semantic Summary
    const semantic = semanticInsightSummary(ctx.insightTags, skinTags as string[])
    setSemanticHint(semantic)

    setLoading(false)
  }, [customerId, visits, totalSales, lineResponseRate, vipRank, churnRisk, daysSinceLastVisit, cycleDays, avgPrice, skinTags]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

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

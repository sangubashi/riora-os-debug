'use client'
/**
 * NextActionPanel.tsx
 * CustomerBottomSheet 内に差し込む「次にやるべきこと」パネル。
 *
 * ── 絶対ルール ──
 * UIデザイン変更禁止。色・spacing・border-radius・layout は
 * 既存 CustomerBottomSheet のスタイルを完全踏襲。
 * 既存カードUIのスタイル値をそのまま使用。
 */
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { logAction } from '@/lib/actionLog'
import type { NextAction, NextActionPriority, SkinTagKey, ActionType } from '@/types'
import { generateNextActions } from '@/lib/nextAction/generateNextActions'
import { PRIORITY_STYLE } from '@/lib/nextAction/scoreActionPriority'

// ─── Props ────────────────────────────────────────────────────────────────────

interface NextActionPanelProps {
  customerId:           string
  staffId:              string | null
  visits:               number
  totalSales:           number
  lineResponseRate:     number
  vipRank:              number
  churnRisk:            number
  daysSinceLastVisit:   number
  skinTags:             SkinTagKey[]
  menuName:             string
  recommendedCycleDays?: number | null
  reservationId:        string | null
  /** 保存完了時に親の行動履歴をリロード */
  onActionLogged:       () => void
  /** STEP5: medium/low 時に compact 表示 */
  compact?:             boolean
  /** PHASE UX-1: 特定のルールIDを表示から除外する（生成ロジック・文言は変更しない） */
  excludeIds?:          string[]
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export default function NextActionPanel(props: NextActionPanelProps) {
  const {
    customerId, staffId, visits, totalSales, lineResponseRate,
    vipRank, churnRisk, daysSinceLastVisit, skinTags,
    menuName, recommendedCycleDays, reservationId, onActionLogged,
    compact = false, excludeIds,
  } = props

  const [actions,    setActions]    = useState<NextAction[]>([])
  const [loading,    setLoading]    = useState(true)
  const [doneIds,    setDoneIds]    = useState<Set<string>>(new Set())
  const [savingId,   setSavingId]   = useState<string | null>(null)

  // ── NextAction 生成 ────────────────────────────────────────────────────────
  const loadActions = useCallback(async () => {
    setLoading(true)
    try {
      const maxCount = compact ? 1 : 3;
      const results = await generateNextActions({
        customerId,
        visits,
        totalSales,
        lineResponseRate,
        vipRank,
        churnRisk,
        daysSinceLastVisit,
        skinTags,
        menuName,
        recommendedCycleDays,
      })
      setActions(excludeIds?.length ? results.filter(a => !excludeIds.includes(a.id)) : results)
    } catch (e) {
      console.error('[NextActionPanel] 生成エラー:', e)
      setActions([])
    } finally {
      setLoading(false)
    }
  }, [
    customerId, visits, totalSales, lineResponseRate, vipRank,
    churnRisk, daysSinceLastVisit, skinTags, menuName, recommendedCycleDays, excludeIds,
  ])

  useEffect(() => {
    loadActions()
  }, [loadActions])

  // ── アクション実施 ─────────────────────────────────────────────────────────
  const handleDone = useCallback(async (action: NextAction) => {
    if (doneIds.has(action.id) || savingId !== null) return
    setSavingId(action.id)

    const { error } = await logAction({
      customerId,
      staffId,
      actionType:    action.logType as ActionType,
      actionPayload: {
        next_action_type:  action.type,
        next_action_title: action.title,
        next_action_score: action.score,
        reservation_id:    reservationId ?? null,
      },
    })

    setSavingId(null)

    if (error) {
      toast.error('保存に失敗しました')
      return
    }

    setDoneIds(prev => new Set(prev).add(action.id))
    toast.success(`${action.title} を記録しました`, { duration: 1800 })
    onActionLogged()
  }, [customerId, staffId, reservationId, doneIds, savingId, onActionLogged])

  // ── ローディング・空表示 ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ background: '#F8F5F0', borderRadius: '22px', padding: '16px' }}>
        <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#C8A58C', fontWeight: 600, marginBottom: '12px' }}>
          💬 会話のきっかけ
        </p>
        {/* Skeleton */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[1, 2].map(i => (
            <div key={i} style={{ background: '#fff', borderRadius: '16px', padding: '14px', border: '1px solid #F0E8E8' }}>
              <div style={{ height: '11px', width: '60px', borderRadius: '6px', background: '#F5EDEE', marginBottom: '8px' }} />
              <div style={{ height: '13px', width: '80%', borderRadius: '6px', background: '#F5EDEE', marginBottom: '6px' }} />
              <div style={{ height: '11px', width: '100%', borderRadius: '6px', background: '#F5EDEE' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (actions.length === 0) return null

  return (
    <div style={{ background: '#F8F5F0', borderRadius: '22px', padding: '16px' }}>
      {/* ヘッダー */}
      <p style={{
        fontSize: '11px', letterSpacing: '0.18em',
        color: '#C8A58C', fontWeight: 600, marginBottom: '12px',
      }}>
        💬 会話のきっかけ
      </p>

      {/* アクションカード一覧 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {actions.map((action, index) => {
          const done    = doneIds.has(action.id)
          const saving  = savingId === action.id
          const pStyle  = PRIORITY_STYLE[action.priority as NextActionPriority]

          return (
            <motion.div
              key={action.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              style={{
                background:   done ? '#F0FAF5' : '#FFFFFF',
                border:       `1px solid ${done ? 'rgba(52,160,112,0.25)' : '#F0E8E8'}`,
                borderRadius: '16px',
                padding:      '12px 14px',
                opacity:      done ? 0.75 : 1,
              }}
            >
              {/* 優先度バッジ + タイトル */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                <span style={{
                  flexShrink: 0,
                  fontSize: '9px', fontWeight: 600, padding: '2px 7px',
                  borderRadius: '999px',
                  background: pStyle.bg,
                  color:      pStyle.color,
                  border:     `1px solid ${pStyle.border}`,
                  letterSpacing: '0.06em',
                  marginTop: '1px',
                }}>
                  {pStyle.label}
                </span>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#5C4033', lineHeight: 1.4 }}>
                  {done ? <s style={{ opacity: 0.5 }}>{action.title}</s> : action.title}
                </p>
              </div>

              {/* 説明文 */}
              {action.reasons && action.reasons.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                  {action.reasons.map(r => (
                    <span key={r} style={{
                      fontSize: '10px', color: '#9F7E6C',
                      background: '#F8F1EC', borderRadius: '999px',
                      padding: '2px 8px', border: '1px solid #EDE0D8',
                    }}>
                      {r}
                    </span>
                  ))}
                </div>
              )}
              <p style={{
                fontSize: '12px', color: '#9F7E6C', lineHeight: 1.6,
                marginBottom: '10px',
              }}>
                {action.description}
              </p>

              {/* CTAボタン */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => handleDone(action)}
                disabled={done || saving}
                style={{
                  width: '100%', padding: '9px',
                  borderRadius: '999px', border: 'none',
                  background: done
                    ? 'rgba(52,160,112,0.1)'
                    : saving
                    ? '#F5D6DB'
                    : pStyle.bg,
                  color: done
                    ? '#34A070'
                    : saving
                    ? '#C8A8B0'
                    : pStyle.color,
                  outline: `1px solid ${done
                    ? 'rgba(52,160,112,0.2)'
                    : saving
                    ? 'transparent'
                    : pStyle.border}`,
                  fontSize: '12px', fontWeight: 700,
                  cursor: done ? 'default' : saving ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                }}
              >
                {done   ? '✓ 実施済み' :
                 saving ? '保存中…'   :
                 action.ctaLabel}
              </motion.button>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

'use client'
/**
 * CustomerAITimelineTab.tsx — AI Timeline タブ (TL-5)
 *
 * CustomerBottomSheet の "timeline" ページとして表示する。
 * 画面構成:
 *   1. 接客リスク検知 (⚠ 決定論ルール)
 *   2. AIまとめ (4セクション: このお客様は/最近の変化/次回意識すること/⚠注意)
 *   3. 会話の入り口 (conversation-starters API)
 *   4. 今日の接客ポイント (Customer Memory)
 *   5. タイムライン (visit/voice/memory/proposal + 派生イベント)
 *
 * 関係性スコア(★1〜5)は Riora OS v1.0 再設計書に基づき完全削除(評価系UI禁止)。
 *
 * 認証: authedFetch 経由で Authorization ヘッダーを付与。
 *       サーバー側で AUTH-2(canAccessCustomer) 適用済み。
 */
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'

// ─── 型 ────────────────────────────────────────────────────────────────────────

type EventType =
  | 'visit' | 'voice' | 'memory' | 'line' | 'proposal'
  | 'nomination_change' | 'long_absence' | 'return' | 'premium_purchase'

interface TimelineEntry {
  id:          string
  type:        EventType
  title:       string
  content:     string | null
  occurred_at: string
}

interface TalkingPoint {
  emoji: string
  text:  string
}

interface TimelineData {
  timeline:      TimelineEntry[]
  aiSummary:     string
  talkingPoints: TalkingPoint[]
}

interface RiskAlert {
  code:    string
  message: string
}

interface AISummaryData {
  summary:      string
  motivation:   'high' | 'medium' | 'low'
  focus:        string | null   // deprecated (kept for backward compat)
  avoid:        string | null
  recentChange: string | null
  nextFocus:    string[]
  risks:        RiskAlert[]
  cached:       boolean
  generated_at: string
}

interface ConversationData {
  starters:     string[]
  cached:       boolean
  generated_at: string
}

// ─── motivation 定数 ───────────────────────────────────────────────────────────

const MOTIVATION_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high:   '🔥 関心度: 高',
  medium: '✨ 関心度: 中',
  low:    '🌱 関心度: 低',
}

const MOTIVATION_STYLE: Record<'high' | 'medium' | 'low', { bg: string; color: string }> = {
  high:   { bg: '#FDE8E8', color: '#C03030' },
  medium: { bg: '#FEF3E2', color: '#A06020' },
  low:    { bg: '#EAF4EA', color: '#306030' },
}

// ─── タイムライン定数 ──────────────────────────────────────────────────────────

const TYPE_ICON: Record<EventType, string> = {
  visit:             '🌿',
  voice:             '🎙',
  memory:            '💌',
  line:              '💬',
  proposal:          '📈',
  nomination_change: '🔄',
  long_absence:      '📭',
  return:            '🎉',
  premium_purchase:  '💎',
}

const TYPE_COLOR: Record<EventType, string> = {
  visit:             '#34A070',
  voice:             '#4878A8',
  memory:            '#D98292',
  line:              '#34A070',
  proposal:          '#8060A8',
  nomination_change: '#D08030',
  long_absence:      '#A88080',
  return:            '#3090A8',
  premium_purchase:  '#8050C8',
}

const TYPE_LABEL: Record<EventType, string> = {
  visit:             '来店',
  voice:             '音声',
  memory:            '記憶',
  line:              'LINE',
  proposal:          '提案',
  nomination_change: '指名変更',
  long_absence:      '長期離脱',
  return:            '再来店',
  premium_purchase:  '高額購入',
}

const RISK_COLOR: Record<string, string> = {
  long_absence:      '#D08030',
  nomination_change: '#A04040',
  price_decline:     '#7060A8',
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

function formatAt(iso: string): string {
  try {
    const d       = new Date(iso)
    const now     = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
    if (diffDays === 0) return '今日'
    if (diffDays === 1) return '昨日'
    if (diffDays < 180) return `${diffDays}日前`
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return iso.slice(0, 10)
  }
}

// ─── スケルトン ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {[56, 100, 140, 56, 56, 56].map((h, i) => (
        <div
          key={i}
          style={{
            height: `${h}px`,
            borderRadius: '16px',
            background: 'linear-gradient(90deg, #F5EEF0 25%, #EDE5E8 50%, #F5EEF0 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.4s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  )
}

// ─── メインコンポーネント ──────────────────────────────────────────────────────

interface Props {
  customerId:   string
  customerName: string
  onBack:       () => void
}

export default function CustomerAITimelineTab({ customerId, customerName, onBack }: Props) {
  const [data,                setData]                = useState<TimelineData | null>(null)
  const [loading,             setLoading]             = useState(true)
  const [error,               setError]               = useState(false)
  const [summaryData,         setSummaryData]         = useState<AISummaryData | null>(null)
  const [summaryLoading,      setSummaryLoading]      = useState(true)
  const [conversationData,    setConversationData]    = useState<ConversationData | null>(null)
  const [conversationLoading, setConversationLoading] = useState(true)
  const [showAllTimeline,     setShowAllTimeline]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setSummaryLoading(true)
    setConversationLoading(true)
    setError(false)
    try {
      const [timelineRes, summaryRes, conversationRes] = await Promise.allSettled([
        authedFetch(`/api/customers/${customerId}/timeline`),
        authedFetch(`/api/customers/${customerId}/timeline-summary`),
        authedFetch(`/api/customers/${customerId}/conversation-starters`),
      ])

      if (timelineRes.status === 'fulfilled' && timelineRes.value.ok) {
        const json = await timelineRes.value.json() as { success: boolean } & TimelineData
        if (json.success) setData(json)
        else setError(true)
      } else {
        setError(true)
      }

      if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
        const json = await summaryRes.value.json() as { success: boolean } & AISummaryData
        if (json.success) setSummaryData(json)
      }

      if (conversationRes.status === 'fulfilled' && conversationRes.value.ok) {
        const json = await conversationRes.value.json() as { success: boolean } & ConversationData
        if (json.success && json.starters.length > 0) setConversationData(json)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setSummaryLoading(false)
      setConversationLoading(false)
    }
  }, [customerId])

  useEffect(() => { void load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── ヘッダー ─────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 20px 12px',
      }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#C8A58C', fontSize: '14px' }}
        >
          <ChevronLeft size={16} strokeWidth={2} />戻る
        </button>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#9F7E6C', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '2px' }}>
            🕮 AI Timeline
          </p>
          <p style={{ fontSize: '17px', fontWeight: 700, color: '#3d2218', marginBottom: '2px' }}>{customerName} 様</p>
          <p style={{ fontSize: '10px', color: '#C8B0B0', letterSpacing: '0.02em' }}>
            AIが顧客を30秒で要約
          </p>
        </div>
        <div style={{ width: '52px' }} />
      </div>

      {/* ── スクロール領域 ─────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '0 20px 32px',
        WebkitOverflowScrolling: 'touch',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}>

        {loading ? (
          <Skeleton />
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#C8A8B0', fontSize: '13px' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.4 }}>⚠️</div>
            データの取得に失敗しました
            <button
              onClick={() => void load()}
              style={{ display: 'block', margin: '12px auto 0', fontSize: '12px', color: '#D98292', background: 'none', border: '1px solid #F5E6E8', borderRadius: '20px', padding: '6px 16px', cursor: 'pointer' }}
            >
              再読み込み
            </button>
          </div>
        ) : !data ? null : (
          <AnimatePresence mode="popLayout">
            <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'contents' }}>

              {/* ── ② 接客リスク検知 ────────────────────────────────────────── */}
              {summaryData && summaryData.risks && summaryData.risks.length > 0 && (
                <div style={{
                  background: '#FFF8F2',
                  borderRadius: '16px', padding: '12px 16px',
                  border: '1px solid #F0D8C0',
                }}>
                  <p style={{ fontSize: '10px', color: '#C07030', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '8px' }}>
                    ⚠ 接客リスク検知
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {summaryData.risks.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{
                          width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                          background: RISK_COLOR[r.code] ?? '#D08030',
                        }} />
                        <p style={{ fontSize: '12px', color: '#7C5030', lineHeight: 1.5 }}>{r.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── ③ AIまとめ (TL-5: 4セクション) ─────────────────────────── */}
              <div style={{
                background: 'linear-gradient(135deg, #FFF8F7 0%, #FDF0F3 100%)',
                borderRadius: '20px', padding: '16px 18px',
                border: '1px solid #F5E6E8',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <p style={{ fontSize: '10px', letterSpacing: '0.18em', color: '#D98292', fontWeight: 700 }}>
                    ✨ AIまとめ
                  </p>
                  {summaryData && (
                    <span style={{
                      fontSize: '9px', padding: '2px 9px', borderRadius: '99px', fontWeight: 700,
                      letterSpacing: '0.04em', border: '1px solid transparent',
                      background: MOTIVATION_STYLE[summaryData.motivation].bg,
                      color:      MOTIVATION_STYLE[summaryData.motivation].color,
                    }}>
                      {MOTIVATION_LABEL[summaryData.motivation]}
                    </span>
                  )}
                </div>

                {summaryLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[56, 40, 80].map((h, i) => (
                      <div key={i} style={{ height: `${h}px`, borderRadius: '10px', background: 'linear-gradient(90deg, #F5EEF0 25%, #EDE5E8 50%, #F5EEF0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                    ))}
                  </div>
                ) : summaryData ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                    {/* 【このお客様はどんな人か】 */}
                    <div>
                      <p style={{ fontSize: '9px', color: '#D98292', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '4px' }}>
                        このお客様はどんな人か
                      </p>
                      <p style={{ fontSize: '13px', color: '#5C4033', lineHeight: 1.8 }}>
                        {summaryData.summary || data.aiSummary}
                      </p>
                    </div>

                    {/* 【最近の変化】 */}
                    {summaryData.recentChange && (
                      <div style={{ background: '#F8F4FF', borderRadius: '12px', padding: '8px 12px' }}>
                        <p style={{ fontSize: '9px', color: '#8060A8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '3px' }}>
                          最近の変化
                        </p>
                        <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.65 }}>{summaryData.recentChange}</p>
                      </div>
                    )}

                    {/* 【次回来店で意識すること】 */}
                    {summaryData.nextFocus && summaryData.nextFocus.length > 0 && (
                      <div style={{ background: '#F0F8F4', borderRadius: '12px', padding: '8px 12px' }}>
                        <p style={{ fontSize: '9px', color: '#30806A', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>
                          次回来店で意識すること
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {summaryData.nextFocus.map((item, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                              <span style={{ fontSize: '11px', color: '#30806A', fontWeight: 700, flexShrink: 0, lineHeight: 1.6 }}>✓</span>
                              <p style={{ fontSize: '12px', color: '#3A5048', lineHeight: 1.6 }}>{item}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ⚠️ 注意 (センシティブ) */}
                    {summaryData.avoid && (
                      <div style={{ background: '#FDF5E0', borderRadius: '12px', padding: '8px 12px' }}>
                        <p style={{ fontSize: '9px', color: '#A07820', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '3px' }}>⚠️ 注意</p>
                        <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.6 }}>{summaryData.avoid}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: '13px', color: '#5C4033', lineHeight: 1.8 }}>
                    {data.aiSummary}
                  </p>
                )}
              </div>

              {/* ── 会話の入り口 ─────────────────────────────────────────────── */}
              {(conversationLoading || conversationData) && (
                <div style={{
                  background: '#FFFDFB',
                  borderRadius: '20px', padding: '14px 18px',
                  border: '1px solid #F0EBE0',
                }}>
                  <p style={{ fontSize: '10px', letterSpacing: '0.18em', color: '#9F7E6C', fontWeight: 700, marginBottom: '10px' }}>
                    💬 会話の入り口
                  </p>
                  {conversationLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {[1, 2].map(i => (
                        <div key={i} style={{ height: '48px', borderRadius: '12px', background: 'linear-gradient(90deg, #F5EEF0 25%, #EDE5E8 50%, #F5EEF0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                      ))}
                    </div>
                  ) : conversationData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {conversationData.starters.map((s, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.08 }}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: '8px',
                            background: '#FFF8F2', borderRadius: '12px',
                            padding: '10px 12px',
                            border: '1px solid #F0E8DC',
                          }}
                        >
                          <span style={{ fontSize: '14px', flexShrink: 0, lineHeight: 1.4 }}>💬</span>
                          <p style={{ fontSize: '13px', color: '#5C4033', lineHeight: 1.65, fontStyle: 'italic' }}>{s}</p>
                        </motion.div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {/* ── 今日の接客ポイント ───────────────────────────────────────── */}
              {data.talkingPoints.length > 0 && (
                <div style={{
                  background: '#fff',
                  borderRadius: '20px', padding: '14px 18px',
                  border: '1px solid #F5EEF0',
                }}>
                  <p style={{ fontSize: '10px', letterSpacing: '0.18em', color: '#5C4033', fontWeight: 700, marginBottom: '10px' }}>
                    💡 今日の接客ポイント
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {data.talkingPoints.map((pt, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.06 }}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}
                      >
                        <span style={{ fontSize: '16px', flexShrink: 0, lineHeight: 1.4 }}>{pt.emoji}</span>
                        <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.65 }}>{pt.text}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── タイムライン ─────────────────────────────────────────────── */}
              {data.timeline.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#C8A8B0' }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.3 }}>📅</div>
                  <p style={{ fontSize: '13px' }}>記録がありません</p>
                  <p style={{ fontSize: '11px', color: '#D8C0C8', marginTop: '4px' }}>
                    来店・音声メモ・記憶・AI提案が時系列で表示されます
                  </p>
                </div>
              ) : (() => {
                const INITIAL_COUNT = 5
                const displayed = showAllTimeline ? data.timeline : data.timeline.slice(0, INITIAL_COUNT)
                const hasMore    = !showAllTimeline && data.timeline.length > INITIAL_COUNT
                return (
                  <div style={{
                    background: '#fff',
                    borderRadius: '20px', padding: '14px 16px',
                    border: '1px solid #F5EEF0',
                  }}>
                    <p style={{ fontSize: '10px', letterSpacing: '0.18em', color: '#9F7E6C', fontWeight: 600, marginBottom: '10px' }}>
                      📅 タイムライン
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {displayed.map((ev, i) => (
                        <motion.div
                          key={ev.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.025 }}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                            padding: '9px 0',
                            borderBottom: i < displayed.length - 1 || hasMore ? '1px solid #F5EEF0' : 'none',
                          }}
                        >
                          {/* タイプバッジ */}
                          <div style={{
                            width: '30px', height: '30px', borderRadius: '50%',
                            background: `${TYPE_COLOR[ev.type]}18`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <span style={{ fontSize: '14px' }}>{TYPE_ICON[ev.type]}</span>
                          </div>

                          {/* 内容 */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                <span style={{
                                  fontSize: '9px', padding: '1px 7px', borderRadius: '99px',
                                  background: `${TYPE_COLOR[ev.type]}14`,
                                  color: TYPE_COLOR[ev.type],
                                  fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0,
                                  border: `1px solid ${TYPE_COLOR[ev.type]}30`,
                                }}>
                                  {TYPE_LABEL[ev.type]}
                                </span>
                                <p style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {ev.title}
                                </p>
                              </div>
                              <span style={{ fontSize: '10px', color: '#B09070', flexShrink: 0, fontFamily: 'Inter, sans-serif' }}>
                                {formatAt(ev.occurred_at)}
                              </span>
                            </div>

                            {ev.content && (
                              <p style={{
                                fontSize: '11px', color: '#9F7E6C', marginTop: '3px', lineHeight: 1.55,
                                overflow: 'hidden', display: '-webkit-box',
                                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              } as React.CSSProperties}>
                                {ev.content}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {hasMore && (
                      <button
                        onClick={() => setShowAllTimeline(true)}
                        style={{
                          display: 'block', width: '100%', marginTop: '10px',
                          padding: '8px 0', background: 'none', border: 'none',
                          fontSize: '12px', color: '#C8A58C', cursor: 'pointer',
                          textAlign: 'center', letterSpacing: '0.04em',
                        }}
                      >
                        もっと見る（残り {data.timeline.length - INITIAL_COUNT}件）
                      </button>
                    )}
                  </div>
                )
              })()}

            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

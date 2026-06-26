'use client'
/**
 * CustomerTimeline.tsx
 * 顧客の接客履歴を時系列で表示。
 * 既存 HistoryAccordion の拡張版として BottomSheet に差し込む。
 *
 * ── 絶対ルール ──
 * UIデザイン変更禁止。色・spacing は既存 BottomSheet と完全一致。
 */
import { useState, useEffect, useCallback, memo} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fetchCustomerTimeline, formatTimelineAt } from '@/lib/aiTimeline'
import { fetchCustomerMemories } from '@/lib/aiMemory'
import { MEMORY_CATEGORY_LABELS, INSIGHT_TAG_LABELS, type InsightTag } from '@/types'
import type { TimelineEvent, MemoryItem } from '@/types'

interface CustomerTimelineProps {
  customerId:  string
  refreshKey?: number
}

const CustomerTimelineInner = function CustomerTimeline({ customerId, refreshKey = 0 }: CustomerTimelineProps) {
  const [events,   setEvents]   = useState<TimelineEvent[]>([])
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState<'timeline' | 'memory'>('timeline')
  const load = useCallback(async () => {
    setLoading(true)
    const [evs, mems] = await Promise.allSettled([
      fetchCustomerTimeline(customerId, 10),
      fetchCustomerMemories(customerId, 6),
    ])
    if (evs.status === 'fulfilled')   setEvents(evs.value)
    if (mems.status === 'fulfilled')  setMemories(mems.value)
    setLoading(false)
  }, [customerId])

  useEffect(() => { load() }, [load, refreshKey])


  const kindColor: Record<TimelineEvent['kind'], string> = {
    visit:   '#C8A58C',
    line:    '#34A070',
    product: '#8060A8',
    voice:   '#4878A8',
    insight: '#F56E8B',
    action:  '#A07020',
  }

  return (
    <div style={{ background: '#F8F5F0', borderRadius: '22px', overflow: 'hidden', flexShrink: 0 }}>

      {/* ヘッダー + タブ */}
      <div style={{ padding: '13px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#A08060', fontWeight: 600 }}>
          📅 AIタイムライン
        </p>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['timeline', 'memory'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontSize: '10px', padding: '3px 9px', borderRadius: '999px',
              border: `1px solid ${tab === t ? '#C8A58C' : '#F0E8E8'}`,
              background: tab === t ? '#FFF8F7' : 'transparent',
              color: tab === t ? '#C8A58C' : '#C8A8B0',
              cursor: 'pointer', fontWeight: tab === t ? 600 : 400,
            }}>
              {t === 'timeline' ? '履歴' : '記憶'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '10px 16px 14px' }}>

        <AnimatePresence mode="wait">

          {/* ── タイムラインタブ ── */}
          {tab === 'timeline' && (
            <motion.div key="timeline"
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
              {loading ? (
                // Skeleton
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[1,2,3].map(i => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ width: '48px', height: '10px', borderRadius: '5px', background: '#EDE5DC' }} />
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#EDE5DC', flexShrink: 0 }} />
                      <div style={{ flex: 1, height: '10px', borderRadius: '5px', background: '#EDE5DC' }} />
                    </div>
                  ))}
                </div>
              ) : events.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
                  <div style={{ fontSize: '18px', marginBottom: '5px', opacity: 0.35 }}>📅</div>
                  <p style={{ fontSize: '12px', color: '#C8A8B0', lineHeight: 1.6 }}>
                    記録がありません<br/>
                    <span style={{ fontSize: '11px', color: '#D8C0C8' }}>接客後に行動を記録すると表示されます</span>
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {events.map((ev, i) => (
                    <motion.div key={ev.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '7px 0', borderBottom: i < events.length - 1 ? '1px solid #EDE5DC' : 'none' }}>
                      {/* 時刻 */}
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#B09070', minWidth: '48px', flexShrink: 0, paddingTop: '1px' }}>
                        {formatTimelineAt(ev.created_at)}
                      </span>
                      {/* ドット */}
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: kindColor[ev.kind], flexShrink: 0, marginTop: '3px' }} />
                      {/* 内容 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '12px', fontWeight: 500, color: '#5C4033' }}>{ev.label}</p>
                        {ev.detail && (
                          <p style={{ fontSize: '11px', color: '#9F7E6C', marginTop: '2px', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                            {ev.detail}
                          </p>
                        )}
                        {ev.insight_tags && ev.insight_tags.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                            {(ev.insight_tags as InsightTag[]).slice(0, 3).map(tag => (
                              <span key={tag} style={{ fontSize: '9px', padding: '1px 7px', borderRadius: '999px', background: '#FFF8F7', color: '#C8A58C', border: '1px solid #F5E6E8', fontWeight: 600, letterSpacing: '0.06em' }}>
                                {INSIGHT_TAG_LABELS[tag] ?? tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── 記憶タブ（AI Memory Surface） ── */}
          {tab === 'memory' && (
            <motion.div key="memory"
              initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.18 }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {[1,2].map(i => (
                    <div key={i} style={{ height: '44px', borderRadius: '12px', background: '#EDE5DC' }} />
                  ))}
                </div>
              ) : memories.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
                  <div style={{ fontSize: '18px', marginBottom: '5px', opacity: 0.35 }}>🧠</div>
                  <p style={{ fontSize: '12px', color: '#C8A8B0', lineHeight: 1.6 }}>
                    記憶はまだありません<br/>
                    <span style={{ fontSize: '11px', color: '#D8C0C8' }}>音声メモから自動で蓄積されます</span>
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {memories.map((mem, i) => (
                    <motion.div key={mem.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      style={{ background: '#fff', borderRadius: '12px', padding: '9px 12px', border: '1px solid #F0E8E8' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '9px', padding: '1px 7px', borderRadius: '999px', background: '#FFF8F7', color: '#C8A58C', border: '1px solid #F5E6E8', fontWeight: 600, letterSpacing: '0.06em' }}>
                          {MEMORY_CATEGORY_LABELS[mem.category] ?? MEMORY_CATEGORY_LABELS['preference']}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#5C4033', lineHeight: 1.6 }}>{mem.content}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

export default memo(CustomerTimelineInner)

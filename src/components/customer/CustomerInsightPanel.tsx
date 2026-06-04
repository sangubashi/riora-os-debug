'use client'
/**
 * CustomerInsightPanel.tsx
 * CustomerBottomSheet の上部に差し込む AIインサイトセクション。
 * 複数の音声メモの insight_tags を集計して表示する。
 * 既存デザイントークンを完全踏襲。
 */
import { useState, useEffect, useCallback, memo} from 'react'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import { aggregateInsightTags } from '@/lib/voiceInsight/extractInsightTags'
import { INSIGHT_TAG_LABELS } from '@/types'
import type { InsightTag } from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface CustomerInsightPanelProps {
  customerId:  string
  /** 外部から再ロードをトリガーするためのカウンター（保存時にインクリメント） */
  refreshKey?: number
}

// ─── タグカラー（重要度別） ────────────────────────────────────────────────────

const TAG_COLOR: Partial<Record<InsightTag, { bg: string; text: string; border: string }>> = {
  price_sensitive:  { bg: '#FFF8EC', text: '#C8840A', border: '#F5D080' },
  event_before:     { bg: '#FFF0F8', text: '#C04880', border: '#F0A8C8' },
  high_motivation:  { bg: '#F0FAF5', text: '#207850', border: '#90D8A8' },
  low_homecare:     { bg: '#FFF0F2', text: '#C04050', border: '#F0A0A8' },
  dryness_concern:  { bg: '#F5F0FA', text: '#7050A8', border: '#C8A8E8' },
  aging_concern:    { bg: '#F8F5F0', text: '#907040', border: '#D8B880' },
  acne_concern:     { bg: '#F0F5FF', text: '#3060B8', border: '#A0B8E8' },
  sensitive_skin:   { bg: '#FFF5F0', text: '#B86040', border: '#E8B890' },
  redness_concern:  { bg: '#FFF0F0', text: '#B84040', border: '#E89090' },
  busy_lifestyle:   { bg: '#F0F0F8', text: '#505090', border: '#A0A0C8' },
}

const DEFAULT_TAG_COLOR = { bg: '#F8F1F3', text: '#9F7E6C', border: '#E8D5D8' }

// ─── コンポーネント ───────────────────────────────────────────────────────────

const CustomerInsightPanelInner = function CustomerInsightPanel({
  customerId,
  refreshKey = 0,
}: CustomerInsightPanelProps) {
  const [topTags,   setTopTags]   = useState<Array<{ tag: InsightTag; count: number }>>([])
  const [noteCount, setNoteCount] = useState(0)
  const [loading,   setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    // DEMO_MODE: Supabase を呼ばない（placeholder.supabase.co 通信を防止）
    if (DEMO_MODE) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('voice_notes')
      .select('insight_tags')
      .eq('customer_id', customerId)
      .not('insight_tags', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error || !data) {
      setLoading(false)
      return
    }

    setNoteCount(data.length)
    const agg = aggregateInsightTags(
      data.map(r => r.insight_tags as string[] | null)
    )
    setTopTags(agg.slice(0, 5) as Array<{ tag: InsightTag; count: number }>)
    setLoading(false)
  }, [customerId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // タグなし or ロード中 → 非表示（スペースを取らない）
  if (loading || topTags.length === 0) return null

  return (
    <div style={{ background: 'linear-gradient(135deg, #FFF8F2 0%, #FFF5F8 100%)', borderRadius: '22px', padding: '16px', border: '1px solid #F5E6E8' }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <p style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#C8A58C', fontWeight: 600 }}>
          🧠 AIインサイト
        </p>
        <span style={{ fontSize: '10px', color: '#C8A8B0', background: '#F8F1F3', padding: '2px 8px', borderRadius: '999px' }}>
          音声メモ {noteCount}件から集計
        </span>
      </div>

      {/* タグ一覧 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {topTags.map(({ tag, count }) => {
          const col = TAG_COLOR[tag] ?? DEFAULT_TAG_COLOR
          return (
            <div key={tag}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', background: col.bg, border: `1px solid ${col.border}` }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: col.text }}>
                {INSIGHT_TAG_LABELS[tag] ?? tag}
              </span>
              {count > 1 && (
                <span style={{ fontSize: '10px', color: col.text, opacity: 0.7, fontFamily: 'Inter, sans-serif' }}>
                  ×{count}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default memo(CustomerInsightPanelInner)

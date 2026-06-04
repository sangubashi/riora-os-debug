/**
 * summarizeTranscript.ts
 * Deterministic サマリー生成エンジン。
 *
 * transcript + insight_tags から要約文を組み立てる。
 * AI不使用。純粋関数。
 *
 * 将来の差し替えポイント:
 *   - Claude API / GPT-4o での要約生成
 *   - Supabase Edge Function 化
 */

import type { InsightTag } from '@/types'
import { INSIGHT_TAG_LABELS } from '@/types'

// ─── サマリー生成 ─────────────────────────────────────────────────────────────

export interface SummarizeParams {
  transcript:  string | null
  tags:        InsightTag[]
  durationSec: number | null
  menuName?:   string | null
  /** true = 本番AI呼び出し（将来実装）/ false = rule-based */
  useLiveAI?:  boolean
}

export interface SummarizeResult {
  summary: string
  isMock:  boolean
  error:   string | null
}

/**
 * 音声メモの要約文を生成する。
 * 現在は deterministic テンプレートで生成。
 */
export function summarizeTranscript(params: SummarizeParams): SummarizeResult {
  const { transcript, tags, durationSec, menuName, useLiveAI = false } = params

  if (useLiveAI) {
    // TODO: Claude API / Edge Function 経由
    return { summary: '', isMock: false, error: '本番AI未実装' }
  }

  const summary = buildRuleBasedSummary({ transcript, tags, durationSec, menuName })
  return { summary, isMock: true, error: null }
}

// ─── ルールベースサマリー ─────────────────────────────────────────────────────

interface BuildParams {
  transcript:  string | null
  tags:        InsightTag[]
  durationSec: number | null
  menuName?:   string | null
}

function buildRuleBasedSummary(params: BuildParams): string {
  const { tags, durationSec, menuName } = params

  const parts: string[] = []

  // 1. メニュー情報
  if (menuName) {
    parts.push(`【施術】${menuName}`)
  }

  // 2. タグからの観察事項（最大3つ）
  const topTags = tags.slice(0, 3)
  if (topTags.length > 0) {
    const tagTexts = topTags.map(t => INSIGHT_TAG_LABELS[t] ?? t).join('・')
    parts.push(`【観察】${tagTexts}`)
  }

  // 3. 録音時間
  if (durationSec && durationSec > 0) {
    const m = Math.floor(durationSec / 60)
    const s = durationSec % 60
    const durStr = m > 0 ? `${m}分${s}秒` : `${s}秒`
    parts.push(`【録音時間】${durStr}`)
  }

  // 4. AI文字起こし待ち表示
  parts.push('（文字起こし: 将来AI自動生成）')

  return parts.join(' / ')
}

// ─── 顧客レベルサマリー（複数メモから） ──────────────────────────────────────

export interface CustomerVoiceSummary {
  /** 最も多く出現したタグトップ3 */
  topInsights:     InsightTag[]
  /** 総録音時間（秒） */
  totalDurationSec: number
  /** メモ件数 */
  noteCount:       number
  /** 最終録音日時 */
  lastNoteAt:      string | null
}

export function buildCustomerVoiceSummary(
  notes: Array<{
    insight_tags:   string[] | null
    duration_sec:   number | null
    created_at:     string
  }>
): CustomerVoiceSummary {
  const tagCounter: Partial<Record<InsightTag, number>> = {}
  let totalDurationSec = 0
  let lastNoteAt: string | null = null

  for (const note of notes) {
    // タグ集計
    for (const tag of (note.insight_tags ?? [])) {
      const k = tag as InsightTag
      tagCounter[k] = (tagCounter[k] ?? 0) + 1
    }
    // 総録音時間
    if (note.duration_sec) totalDurationSec += note.duration_sec
    // 最終録音
    if (!lastNoteAt || note.created_at > lastNoteAt) {
      lastNoteAt = note.created_at
    }
  }

  const topInsights = (Object.entries(tagCounter) as [InsightTag, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag)

  return {
    topInsights,
    totalDurationSec,
    noteCount:  notes.length,
    lastNoteAt,
  }
}

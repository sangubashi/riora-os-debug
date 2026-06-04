/**
 * streamPipeline.ts  — PHASE 10.3 / STEP 1
 *
 * Streaming Voice Pipeline
 * "話した瞬間からRioraが理解している" 体験を作る。
 *
 * 設計原則:
 *   - 純粋関数ベース（副作用は最小限・明示的に分離）
 *   - 0.5秒以内に最初の insight を返す
 *   - cancel/timeout を確実に処理し接客テンポを壊さない
 *   - Whisper 未接続時は deterministic fallback で動作継続
 */

import { extractInsightTags } from '@/lib/voiceInsight/extractInsightTags'
import { normalizeTranscript } from '@/lib/voice/domainDictionary'
import { debounce } from '@/lib/stability'

// ─── 公開型 ──────────────────────────────────────────────────────────────────

export type PartialTranscript = {
  text:       string
  confidence: number   // 0〜1
  timestamp:  number   // performance.now()
}

export type StreamingInsight = {
  tags:       string[]
  sentiment?: string                       // 'positive' | 'neutral' | 'negative'
  urgency?:   'low' | 'medium' | 'high'
}

// ─── 内部型 ──────────────────────────────────────────────────────────────────

export interface StreamPipelineCallbacks {
  /** 部分文字起こしが更新されるたびに呼ばれる */
  onPartialTranscript?: (pt: PartialTranscript) => void
  /** insight_tags が段階生成されるたびに呼ばれる */
  onStreamingInsight?:  (si: StreamingInsight) => void
  /** パイプライン完了時（最終結果） */
  onComplete?:          (result: StreamPipelineResult) => void
  /** エラー時（fallback 結果を含む） */
  onError?:             (err: unknown, fallback: StreamPipelineResult) => void
}

export interface StreamPipelineResult {
  transcript:   string
  summary:      string
  tags:         string[]
  sentiment:    string
  urgency:      'low' | 'medium' | 'high'
  isFallback:   boolean
}

export interface StreamPipelineOptions {
  timeoutMs?:    number   // デフォルト 8000ms
  debounceMs?:   number   // 部分文字起こしの debounce（デフォルト 300ms）
  maxRetries?:   number   // デフォルト 2
}

// ─── AbortController ラッパー ─────────────────────────────────────────────────

export class StreamPipelineController {
  private abortCtrl = new AbortController()
  private _cancelled = false

  get signal()    { return this.abortCtrl.signal }
  get cancelled() { return this._cancelled }

  cancel(): void {
    this._cancelled = true
    this.abortCtrl.abort()
  }
}

// ─── 感情・緊急度推定（deterministic） ───────────────────────────────────────

function detectSentiment(text: string): string {
  const pos = ['嬉しい', '楽しい', 'ありがとう', '良かった', '好き', '気持ちいい', '満足', '最高']
  const neg = ['不安', '心配', '痛い', '辛い', '悩み', '困って', 'できない', '嫌']
  const posHit = pos.some(w => text.includes(w))
  const negHit = neg.some(w => text.includes(w))
  if (posHit && !negHit) return 'positive'
  if (negHit)            return 'negative'
  return 'neutral'
}

function detectUrgency(tags: string[]): 'low' | 'medium' | 'high' {
  if (tags.includes('event_before') || tags.includes('inactive_risk')) return 'high'
  if (tags.includes('price_sensitive') || tags.includes('dryness_concern')) return 'medium'
  return 'low'
}

// ─── 部分文字起こしシミュレータ（Whisper 未接続時の fallback） ───────────────
// 将来: Whisper WebSocket / Edge Function に差し替え

function buildFallbackTranscript(durationSec: number): string {
  if (durationSec <= 10) return '肌の状態について記録しました。'
  if (durationSec <= 30) return '今日の施術とお客様の反応、次回のご提案について記録しました。'
  return '詳細な接客内容、肌状態の観察、ホームケアのご提案、次回来店の意向について記録しました。'
}

// ─── ストリーミング処理コア ───────────────────────────────────────────────────

/**
 * テキストチャンクを受け取るたびに insight を段階生成する純粋関数。
 * 累積テキストに対して毎回 extractInsightTags を適用。
 */
export function processTextChunk(
  accumulatedText: string,
  prevTags: string[]
): { insight: StreamingInsight | null; newTags: string[] } {
  if (accumulatedText.length < 5) return { insight: null, newTags: prevTags }

  const normalized = normalizeTranscript(accumulatedText)
  const { tags }   = extractInsightTags([normalized])

  // タグの変化があった時だけ insight を返す（不要な更新を防ぐ）
  const hasNewTag = tags.some(t => !prevTags.includes(t))
  if (!hasNewTag && tags.length === prevTags.length) {
    return { insight: null, newTags: prevTags }
  }

  const insight: StreamingInsight = {
    tags,
    sentiment: detectSentiment(normalized),
    urgency:   detectUrgency(tags),
  }

  return { insight, newTags: tags }
}

// ─── パイプライン実行 ─────────────────────────────────────────────────────────

export async function runStreamPipeline(
  params: {
    audioBlob:      Blob
    durationSec:    number
    /** Whisper API の endpoint（未指定 = fallback モード） */
    whisperEndpoint?: string
  },
  callbacks: StreamPipelineCallbacks,
  options:   StreamPipelineOptions = {},
  controller: StreamPipelineController = new StreamPipelineController()
): Promise<StreamPipelineResult> {
  const {
    timeoutMs  = 8000,
    debounceMs = 300,
    maxRetries = 2,
  } = options

  const { onPartialTranscript, onStreamingInsight, onComplete, onError } = callbacks

  // タイムアウト設定
  const timeoutId = setTimeout(() => controller.cancel(), timeoutMs)

  // debounce された insight 通知
  const debouncedInsight = onStreamingInsight
    ? debounce((si: StreamingInsight) => {
        if (!controller.cancelled) onStreamingInsight(si)
      }, debounceMs)
    : null

  let attempt = 0

  while (attempt <= maxRetries) {
    if (controller.cancelled) break
    attempt++

    try {
      const result = await executePipeline(
        params,
        { onPartialTranscript, onStreamingInsight: debouncedInsight ?? undefined },
        controller
      )

      clearTimeout(timeoutId)
      onComplete?.(result)
      return result

    } catch (err) {
      if (controller.cancelled || attempt > maxRetries) {
        clearTimeout(timeoutId)
        const fallback = buildFallbackResult(params.durationSec)
        onError?.(err, fallback)
        onComplete?.(fallback)
        return fallback
      }
      // retry 前に少し待つ
      await sleep(400 * attempt)
    }
  }

  clearTimeout(timeoutId)
  const fallback = buildFallbackResult(params.durationSec)
  onComplete?.(fallback)
  return fallback
}

// ─── 実行コア ─────────────────────────────────────────────────────────────────

async function executePipeline(
  params: { audioBlob: Blob; durationSec: number; whisperEndpoint?: string },
  callbacks: {
    onPartialTranscript?: (pt: PartialTranscript) => void
    onStreamingInsight?:  (si: StreamingInsight) => void
  },
  controller: StreamPipelineController
): Promise<StreamPipelineResult> {
  const { durationSec, whisperEndpoint } = params

  let fullTranscript: string
  let currentTags: string[] = []

  if (whisperEndpoint) {
    // ── 本番: Whisper streaming（将来実装） ──────────────────────────────
    // TODO: fetch streaming API → onPartialTranscript を逐次呼ぶ
    // 現在は fallback に倒す
    throw new Error('Whisper endpoint not implemented')

  } else {
    // ── Fallback: deterministic transcript → 段階的に送出 ────────────────
    fullTranscript = buildFallbackTranscript(durationSec)

    // "段階的" に見せるため、文を分割してチャンク送出
    const chunks = splitIntoChunks(fullTranscript)
    let accumulated = ''

    for (let i = 0; i < chunks.length; i++) {
      if (controller.cancelled) break

      // 最初のチャンクは即座に（0.5秒以内の反応）
      if (i > 0) await sleep(200)

      accumulated += chunks[i]

      // 部分文字起こしを通知
      callbacks.onPartialTranscript?.({
        text:       accumulated,
        confidence: 0.5 + i * 0.15,   // 徐々に confidence が上がる
        timestamp:  performance.now(),
      })

      // insight を段階生成
      const { insight, newTags } = processTextChunk(accumulated, currentTags)
      if (insight) {
        currentTags = newTags
        callbacks.onStreamingInsight?.(insight)
      }
    }
  }

  if (controller.cancelled) {
    return buildFallbackResult(durationSec)
  }

  // 最終 insight を確定
  const normalized = normalizeTranscript(fullTranscript)
  const { tags }   = extractInsightTags([normalized])
  const sentiment  = detectSentiment(normalized)
  const urgency    = detectUrgency(tags)

  return {
    transcript:  normalized,
    summary:     buildSummary(normalized, tags),
    tags,
    sentiment,
    urgency,
    isFallback:  !params.whisperEndpoint,
  }
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function buildFallbackResult(durationSec: number): StreamPipelineResult {
  const transcript = buildFallbackTranscript(durationSec)
  const { tags }   = extractInsightTags([transcript])
  return {
    transcript,
    summary:    transcript,
    tags,
    sentiment:  'neutral',
    urgency:    'low',
    isFallback: true,
  }
}

function buildSummary(transcript: string, tags: string[]): string {
  if (tags.length === 0) return transcript.slice(0, 80)
  const tagStr = tags.slice(0, 3).join('・')
  return `【${tagStr}】${transcript.slice(0, 60)}`
}

function splitIntoChunks(text: string): string[] {
  // 文節ごとに分割（。、で区切り + 残り）
  const parts = text.split(/(?<=[。、])/)
  return parts.length > 1 ? parts : [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

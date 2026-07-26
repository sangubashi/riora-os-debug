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
        const pending = buildPendingResult()
        onError?.(err, pending)
        onComplete?.(pending)
        return pending
      }
      // retry 前に少し待つ
      await sleep(400 * attempt)
    }
  }

  clearTimeout(timeoutId)
  const pending = buildPendingResult()
  onComplete?.(pending)
  return pending
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
  const { whisperEndpoint } = params

  if (whisperEndpoint) {
    // ── 本番: Whisper streaming（将来実装） ──────────────────────────────
    // TODO: fetch streaming API → onPartialTranscript を逐次呼ぶ
    // 現在は未実装のため例外を投げ、呼び出し元(runStreamPipeline)が
    // 「準備中」結果にフォールバックする(捏造データは絶対に返さない)。
    throw new Error('Whisper endpoint not implemented')
  }

  if (controller.cancelled) {
    return buildPendingResult()
  }

  // Whisper 未接続: 固定文言の文字起こしは生成しない。
  // 「文字起こし準備中」として扱い、実際の内容はスタッフが「編集」から入力する。
  return buildPendingResult()
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

/** Whisper 未接続時の結果。文字起こしは行わない(嘘のデータを作らない)。 */
function buildPendingResult(): StreamPipelineResult {
  return {
    transcript: '',
    summary:    '',
    tags:       [],
    sentiment:  'neutral',
    urgency:    'low',
    isFallback: true,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

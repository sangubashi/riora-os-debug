/**
 * voiceNote.ts  —  voice_notes CRUD + Supabase Storage
 *
 * Storage パス: voice-notes/{staffId}/{customerId}/{timestamp}.webm
 * iPhone Safari: MediaRecorder は audio/mp4 を優先使用
 */
import { supabase, DEMO_MODE } from '@/lib/supabase'
import { withRetry, prodLog } from '@/lib/stability'
import { logAction } from '@/lib/actionLog'
import { transcribeAudio } from '@/lib/voiceInsight/mockTranscript'
import { extractInsightTags } from '@/lib/voiceInsight/extractInsightTags'
import { summarizeTranscript } from '@/lib/voiceInsight/summarizeTranscript'
import { extractMemoryCandidates, saveMemoryItems } from '@/lib/aiMemory'
import { normalizeTranscript } from '@/lib/voice/domainDictionary'
import type { VoiceNote } from '@/types'

// ─── MIME type（iPhone Safari 対応） ─────────────────────────────────────────

export function getSupportedMimeType(): string {
  // iPhone Safari は audio/mp4 のみサポート
  const types = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t
    }
  }
  return 'audio/mp4' // Safari fallback
}

export function getFileExtension(mimeType: string): string {
  if (mimeType.startsWith('audio/mp4')) return 'mp4'
  if (mimeType.startsWith('audio/webm')) return 'webm'
  if (mimeType.startsWith('audio/ogg')) return 'ogg'
  return 'mp4'
}

// ─── Storage アップロード ─────────────────────────────────────────────────────

export interface UploadVoiceNoteParams {
  blob:          Blob
  staffId:       string
  customerId:    string
  reservationId: string | null
  durationSec:   number
}

export interface UploadResult {
  voiceNoteId: string | null
  storagePath: string | null
  error:       string | null
}


// ─── STEP8: ローカル一時保存フォールバック ────────────────────────────────────
// オフライン時に IndexedDB or sessionStorage に一時保存。
// オンライン復帰時に再送できる設計。（将来実装: Service Worker 連携）

interface LocalFallbackData {
  path:        string
  customerId:  string
  durationSec: number
  savedAt:     number
}

function saveLocalFallback(params: {
  blob:        Blob
  path:        string
  customerId:  string
  durationSec: number
}): void {
  try {
    const meta: LocalFallbackData = {
      path:        params.path,
      customerId:  params.customerId,
      durationSec: params.durationSec,
      savedAt:     Date.now(),
    }
    // sessionStorage にメタデータのみ保存（Blob は URL.createObjectURL で保持）
    const key = `riora_voice_fallback_${Date.now()}`
    sessionStorage.setItem(key, JSON.stringify(meta))
    prodLog('info', '[voiceNote] ローカル一時保存完了', meta.path)
  } catch {
    // sessionStorage が使えない環境（プライベートモード等）では無視
    prodLog('warn', '[voiceNote] ローカル一時保存失敗 — sessionStorage 利用不可')
  }
}

export async function uploadVoiceNote(params: UploadVoiceNoteParams): Promise<UploadResult> {
  const { blob, staffId, customerId, reservationId, durationSec } = params

  // DEMO_MODE: ストレージ・DB を呼ばずダミー成功を返す
  if (DEMO_MODE) {
    return { voiceNoteId: `demo-vn-${Date.now()}`, storagePath: 'demo/path.mp4', error: null }
  }

  const ext       = getFileExtension(blob.type || 'audio/mp4')
  const timestamp = Date.now()
  const path      = `${staffId}/${customerId}/${timestamp}.${ext}`

  // STEP8: オフライン検出 → ローカル一時保存フォールバック
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    prodLog('warn', '[voiceNote] オフライン検出 — ローカル一時保存')
    saveLocalFallback({ blob, path, customerId, durationSec })
    return { voiceNoteId: null, storagePath: path, error: 'オフラインのため一時保存しました' }
  }

  // 1. Storage アップロード（STEP8: withRetry で自動リトライ）
  const uploadResult = await withRetry(
    () => supabase.storage.from('voice-notes').upload(path, blob, {
      contentType: blob.type || 'audio/mp4',
      upsert:      false,
    }),
    { maxAttempts: 2, delayMs: 800, backoff: false }
  ).catch(e => ({ error: { message: String(e) } as { message: string } }))

  if ('error' in uploadResult && uploadResult.error) {
    prodLog('error', '[voiceNote] Storage upload failed', uploadResult.error.message)
    return { voiceNoteId: null, storagePath: null, error: uploadResult.error.message }
  }

  // 2. DB レコード作成
  const { data: row, error: dbErr } = await supabase
    .from('voice_notes')
    .insert({
      customer_id:    customerId,
      staff_id:       staffId,
      reservation_id: reservationId ?? null,
      storage_path:   path,
      duration_sec:   durationSec,
      transcript:     null,
      summary:        null,
    })
    .select('id')
    .single()

  if (dbErr || !row) {
    prodLog('error', '[voiceNote] DB insert failed', dbErr?.message)
    return { voiceNoteId: null, storagePath: path, error: dbErr?.message ?? 'DB保存失敗' }
  }

  // 3. インサイト生成パイプライン（非同期・失敗してもアップロード成功扱い）
  void runInsightPipeline({
    voiceNoteId:   row.id,
    storagePath:   path,
    durationSec,
    customerId,
    staffId,
    reservationId: reservationId ?? null,
  })

  // 4. action_log: voice_note_created
  await logAction({
    customerId,
    staffId,
    actionType:    'voice_note_created',
    actionPayload: {
      voice_note_id:  row.id,
      storage_path:   path,
      duration_sec:   durationSec,
      reservation_id: reservationId ?? null,
    },
  })

  return { voiceNoteId: row.id, storagePath: path, error: null }
}

// ─── インサイト生成パイプライン ───────────────────────────────────────────────

interface InsightPipelineParams {
  voiceNoteId:   string
  storagePath:   string
  durationSec:   number
  customerId:    string
  staffId:       string
  reservationId: string | null
  /** STEP4: 段階的更新コールバック（UI への optimistic 通知用） */
  onStageUpdate?: (stage: 'tags' | 'summary' | 'complete', data: {
    tags?:    string[]
    summary?: string
  }) => void
}

/**
 * 音声保存後に非同期で実行される解析パイプライン。
 * transcript → summary → insight_tags → DB更新 → action_log
 *
 * 将来: transcribeAudio を Whisper API に差し替えるだけで本番化できる。
 */
async function runInsightPipeline(params: InsightPipelineParams): Promise<void> {
  const { voiceNoteId, storagePath, durationSec, customerId, staffId } = params
  // onStageUpdate は params から直接参照（分割代入しない）

  try {
    // 1. analysis_status を processing に更新
    await supabase.from('voice_notes')
      .update({ analysis_status: 'processing' })
      .eq('id', voiceNoteId)

    // 2. 文字起こし（現在はmock / 将来Whisper差し替えポイント）
    const { transcript: rawTranscript } = await transcribeAudio({
      storagePath,
      durationSec,
      useLiveAI: false,
    })

    // 2b. Domain Dictionary で補正（Whisper誤変換を修正）
    const transcript = normalizeTranscript(rawTranscript ?? '')

    // 3. タグ抽出 → 0.5秒以内に最初の反応を返す（optimistic）
    const { tags } = extractInsightTags([transcript])
    params.onStageUpdate?.('tags', { tags })

    // 3b. tags だけ先にDB保存（analysis_status は processing のまま）
    await supabase.from('voice_notes')
      .update({ insight_tags: tags })
      .eq('id', voiceNoteId)

    // 4. サマリー生成 → silent update
    const { summary } = summarizeTranscript({
      transcript,
      tags,
      durationSec,
      useLiveAI: false,
    })
    params.onStageUpdate?.('summary', { tags, summary })

    // 4b. InsightGenerator で次回提案・NGワード・購入傾向を抽出
    const { generateInsightsFromNotes } = await import('@/lib/voiceInsight/InsightGenerator')
    const generated = generateInsightsFromNotes([{ transcript, summary, insight_tags: tags }])

    // 5. DB 最終確定（全フィールド一括）
    const { error: updateErr } = await supabase.from('voice_notes')
      .update({
        transcript,
        summary,
        insight_tags:     tags,
        next_suggestion:  generated.suggestions[0]?.treatment ?? null,
        ng_topics:        generated.ngAlerts.map(n => ({ tag: n.tag, topic: n.topic, severity: n.severity })),
        buy_tendency:     generated.buyTendencies.map(b => ({ tag: b.tag, style: b.style })),
        insight_summary:  generated.summary,
        analysis_status:  'completed',
        analyzed_at:      new Date().toISOString(),
      })
      .eq('id', voiceNoteId)

    if (updateErr) {
      prodLog('warn', '[voiceInsight] DB update failed', updateErr.message)
      await supabase.from('voice_notes')
        .update({ analysis_status: 'failed' })
        .eq('id', voiceNoteId)
      return
    }

    // 6. AI Memory: transcript から記憶を抽出して保存（Silent）
    const memText = [transcript, summary].filter(Boolean).join(' ')
    if (memText.length > 10) {
      const memoryCandidates = extractMemoryCandidates(memText)
      if (memoryCandidates.length > 0) {
        void saveMemoryItems(customerId, memoryCandidates)
      }
    }

    // 7. action_log: voice_insight_generated
    await logAction({
      customerId,
      staffId,
      actionType:    'voice_insight_generated',
      actionPayload: {
        voice_note_id: voiceNoteId,
        tag_count:     tags.length,
        tags,
      },
    })

    params.onStageUpdate?.('complete', { tags, summary })
    prodLog('info', `[voiceInsight] 完了 id=${voiceNoteId.slice(0, 8)}… tags=[${tags.join(',')}]`)
  } catch (e) {
    prodLog('error', '[voiceInsight] pipeline error', e)
    await supabase.from('voice_notes')
      .update({ analysis_status: 'failed' })
      .eq('id', voiceNoteId)
      .then(() => {/* ignore cleanup error */})
  }
}

// ─── 署名付きURL取得（再生用） ────────────────────────────────────────────────

export async function getVoiceNoteUrl(storagePath: string): Promise<string | null> {
  if (DEMO_MODE) return null   // Supabase Storage を呼ばない

  const { data, error } = await supabase.storage
    .from('voice-notes')
    .createSignedUrl(storagePath, 3600) // 1時間有効

  if (error || !data?.signedUrl) {
    // bucket 未作成（NoSuchBucket）は silent — 再生できないだけで止まらない
    if (error?.message && !error.message.includes('NoSuchBucket')) {
      prodLog('warn', '[voiceNote] createSignedUrl failed', error.message)
    }
    return null
  }
  return data.signedUrl
}

// ─── 削除 ────────────────────────────────────────────────────────────────────

export async function deleteVoiceNote(voiceNoteId: string, storagePath: string): Promise<{ error: string | null }> {
  if (DEMO_MODE) return { error: null }   // Supabase を呼ばない

  // DB から削除（CASCADE で storage_path は残るが管理上削除）
  const { error: dbErr } = await supabase
    .from('voice_notes')
    .delete()
    .eq('id', voiceNoteId)

  if (dbErr) {
    prodLog('error', '[voiceNote] DB delete failed:', dbErr.message)
    return { error: dbErr.message }
  }

  // Storage から削除
  const { error: storageErr } = await supabase.storage
    .from('voice-notes')
    .remove([storagePath])

  if (storageErr) {
    // Storage削除失敗はDB削除成功後なのでログのみ（UIには影響しない）
    prodLog('warn', '[voiceNote] Storage remove failed (DB already deleted):', storageErr.message)
  }

  return { error: null }
}

// ─── 顧客別メモ取得 ──────────────────────────────────────────────────────────

export interface VoiceNoteRow extends VoiceNote {
  displayAt: string
}

export async function fetchVoiceNotes(customerId: string, limit = 5): Promise<VoiceNoteRow[]> {
  if (DEMO_MODE) return []   // Supabase を呼ばない

  const { data, error } = await supabase
    .from('voice_notes')
    .select('id, customer_id, staff_id, reservation_id, storage_path, transcript, summary, insight_tags, duration_sec, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    prodLog('error', '[voiceNote] fetch failed:', error?.message)
    return []
  }

  return (data as VoiceNote[]).map(row => ({
    ...row,
    displayAt: formatAt(row.created_at),
  }))
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function formatAt(iso: string): string {
  try {
    const d   = new Date(iso)
    const m   = d.getMonth() + 1
    const day = d.getDate()
    const h   = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${m}/${day} ${h}:${min}`
  } catch {
    return iso.slice(0, 16)
  }
}

export function formatDuration(sec: number | null): string {
  if (sec === null || sec <= 0) return '--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0
    ? `${m}:${String(s).padStart(2, '0')}`
    : `${s}秒`
}

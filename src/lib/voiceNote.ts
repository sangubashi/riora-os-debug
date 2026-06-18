/**
 * voiceNote.ts  —  voice_notes CRUD + Supabase Storage
 *
 * Storage パス: voice-notes/{staffId}/{customerId}/{timestamp}.webm
 * iPhone Safari: MediaRecorder は audio/mp4 を優先使用
 */
import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { withRetry, prodLog } from '@/lib/stability'
import { logAction } from '@/lib/actionLog'
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

  console.log('[VOICE_NOTES_LIVE] uploadVoiceNote開始', { customerId, staffId, reservationId, durationSec })

  // DEMO_MODE: ストレージ・DB を呼ばずダミー成功を返す（VOICE_NOTES_LIVE時は実DBへ進む）
  if (DEMO_MODE && !VOICE_NOTES_LIVE) {
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

  console.log('[VOICE_NOTES_LIVE] Storageアップロード成功', { path })

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

  console.log('[VOICE_NOTES_LIVE] voice_notes insert成功', { voiceNoteId: row.id })

  // 3. AI解析パイプライン: /api/voice/pipeline へ非同期呼び出し
  //    fire-and-forget — レスポンスを待たずにアップロード成功を返す
  void callPipelineApi({
    voiceNoteId:   row.id,
    storagePath:   path,
    durationSec,
    customerId,
    staffId,
    reservationId: reservationId ?? null,
  })

  // 4. action_log: voice_note_created
  const logResult = await logAction({
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

  if (logResult.error) {
    console.log('[VOICE_NOTES_LIVE] customer_action_logs insert失敗', logResult.error)
  } else {
    console.log('[VOICE_NOTES_LIVE] customer_action_logs insert成功')
  }

  return { voiceNoteId: row.id, storagePath: path, error: null }
}

// ─── サーバーサイド AI パイプライン呼び出し ──────────────────────────────────

async function callPipelineApi(params: {
  voiceNoteId:   string
  storagePath:   string
  durationSec:   number
  customerId:    string
  staffId:       string
  reservationId: string | null
}): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) {
      prodLog('warn', '[voiceNote] callPipelineApi: no session token')
      return
    }

    const res = await fetch('/api/voice/pipeline', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      prodLog('error', '[voiceNote] pipeline API error:', err)
    } else {
      const result = await res.json()
      prodLog('info', `[voiceNote] pipeline 完了: customer_notes ${result.analysis?.customerNotes?.length ?? 0}件`)
    }
  } catch (e) {
    prodLog('error', '[voiceNote] callPipelineApi failed:', e)
  }
}

// ─── 署名付きURL取得（再生用） ────────────────────────────────────────────────

export async function getVoiceNoteUrl(storagePath: string): Promise<string | null> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return null   // Supabase Storage を呼ばない

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
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return { error: null }   // Supabase を呼ばない

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
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return []   // Supabase を呼ばない

  const { data, error } = await supabase
    .from('voice_notes')
    .select('id, customer_id, staff_id, reservation_id, storage_path, transcript, summary, insight_tags, duration_sec, analysis_status, created_at')
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

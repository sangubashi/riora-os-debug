'use client'
/**
 * VoiceMemoSection.tsx — Pass VN-1 Voice Note UX安全強化版
 *
 * 4段階フロー（設計書 v1.0 準拠）:
 *   ① 録音中   : タイマー表示 + [キャンセル] [停止]
 *   ② 確認画面 : 音声再生 + transcript全文 + [破棄] [編集] [保存へ]
 *   ③ 編集     : transcript 自由修正
 *   ④ 選択保存 : Customer Memory 候補チェックボックス → 選択のみ保存
 *
 * 安全保証:
 *   - 録音しただけでは DB に何も保存されない
 *   - スタッフがチェックしたメモリだけ customer_memories に保存
 *   - 5秒 Undo toast で voice_notes + customer_memories を完全ロールバック
 *
 * 監査ログ: VOICE_STARTED / VOICE_CANCELLED / VOICE_DISCARDED / VOICE_SAVED / VOICE_UNDO
 */
import { useState, useRef, useCallback, useEffect, memo } from 'react'
import type { CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { prodLog } from '@/lib/stability'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import {
  uploadVoiceNote,
  fetchVoiceNotes,
  deleteVoiceNote,
  getVoiceNoteUrl,
  type VoiceNoteRow,
} from '@/lib/voiceNote'
import {
  runStreamPipeline,
  StreamPipelineController,
} from '@/lib/voice/streamPipeline'
import { extractCustomerNotes } from '@/lib/voiceInsight/extractCustomerNotes'
import type { MemoryType } from '@/types/customerMemory'
import { logAction } from '@/lib/actionLog'
import { authedFetch } from '@/lib/api/authedFetch'
import VoiceNotesList from './VoiceNotesList'

// ─── 型 ──────────────────────────────────────────────────────────────────────

/** 録音後の UI フェーズ（status==='stopped' 時のみ有効） */
type PostPhase = 'confirming' | 'editing' | 'selecting' | 'saving'

interface MemoryCandidate {
  idx:        number
  content:    string
  memoryType: MemoryType
}

interface SavedState {
  voiceNoteId: string
  storagePath: string
  memoryIds:   string[]
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const CATEGORY_TO_MEMORY_TYPE: Record<string, MemoryType> = {
  Family:     'family',
  Work:       'occupation',
  Health:     'other',
  Preference: 'hobby',
  Event:      'life_event',
}

// ─── スタイルヘルパー ─────────────────────────────────────────────────────────

function pill(bg: string, color: string, borderColor?: string): CSSProperties {
  return {
    padding:      '11px',
    borderRadius: '999px',
    background:   bg,
    color,
    border:       borderColor ? `1.5px solid ${borderColor}` : 'none',
    fontSize:     '13px',
    fontWeight:   600,
    cursor:       'pointer',
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  customerId:    string
  staffId:       string | null
  reservationId: string | null
  onSaved:       () => void
  onSuggestion?: (hint: string) => void
  onRecordingStateChange?: (isRecording: boolean) => void
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

const VoiceMemoSectionInner = memo(function VoiceMemoSection({
  customerId,
  staffId,
  reservationId,
  onSaved,
  onSuggestion,
  onRecordingStateChange,
}: Props) {
  const {
    status, durationSec, audioBlob, audioUrl, errorMessage,
    start, stop, reset,
  } = useVoiceRecorder()

  // ── 録音後フェーズ（status==='stopped' 時のみ非 null） ──
  const [postPhase,          setPostPhase]          = useState<PostPhase | null>(null)
  const [transcript,         setTranscript]         = useState('')
  const [editBuffer,         setEditBuffer]         = useState('')
  const [transcriptLoading,  setTranscriptLoading]  = useState(false)
  const [candidates,         setCandidates]         = useState<MemoryCandidate[]>([])
  const [checkedSet,         setCheckedSet]         = useState<Set<number>>(new Set())
  const [isSaving,           setIsSaving]           = useState(false)

  // ── 過去メモ ──
  const [pastNotes,    setPastNotes]    = useState<VoiceNoteRow[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [playingId,    setPlayingId]    = useState<string | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)

  const pipelineCtrlRef = useRef<StreamPipelineController | null>(null)
  const audioRef        = useRef<HTMLAudioElement | null>(null)
  const savedRef        = useRef<SavedState | null>(null)
  const durRef          = useRef(0)

  // durationSec を ref に同期
  useEffect(() => { durRef.current = durationSec }, [durationSec])

  // ── 過去メモ読み込み ──────────────────────────────────────────────────────
  const loadNotes = useCallback(async () => {
    setNotesLoading(true)
    const rows = await fetchVoiceNotes(customerId, 10)
    setPastNotes(rows)
    setNotesLoading(false)
  }, [customerId])

  useEffect(() => { loadNotes() }, [loadNotes])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      pipelineCtrlRef.current?.cancel()
    }
  }, [])

  // ── 録音停止 → 確認フェーズ + transcript 取得 ────────────────────────────
  useEffect(() => {
    if (status !== 'stopped' || !audioBlob || postPhase !== null) return

    setPostPhase('confirming')
    setTranscript('')
    setTranscriptLoading(true)

    pipelineCtrlRef.current?.cancel()
    const ctrl = new StreamPipelineController()
    pipelineCtrlRef.current = ctrl

    void runStreamPipeline(
      { audioBlob, durationSec: durRef.current },
      {
        onPartialTranscript: (pt) => { if (!ctrl.cancelled) setTranscript(pt.text) },
        onComplete: (r) => {
          if (!ctrl.cancelled) {
            setTranscript(r.transcript)
            setTranscriptLoading(false)
          }
        },
        onError: (_e, fallback) => {
          if (!ctrl.cancelled) {
            setTranscript(fallback.transcript)
            setTranscriptLoading(false)
          }
        },
      },
      {},
      ctrl
    )
  }, [status, audioBlob, postPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 監査ログ ──────────────────────────────────────────────────────────────
  const audit = useCallback((
    type: 'voice_started' | 'voice_cancelled' | 'voice_discarded' | 'voice_saved' | 'voice_undo',
    payload?: Record<string, unknown>
  ) => {
    void logAction({ customerId, staffId, actionType: type, actionPayload: payload })
  }, [customerId, staffId])

  // ── フルリセット ──────────────────────────────────────────────────────────
  const fullReset = useCallback(() => {
    pipelineCtrlRef.current?.cancel()
    reset()
    setPostPhase(null)
    setTranscript('')
    setEditBuffer('')
    setTranscriptLoading(false)
    setCandidates([])
    setCheckedSet(new Set())
    setIsSaving(false)
    onRecordingStateChange?.(false)
  }, [reset, onRecordingStateChange])

  // ── ① 録音開始 ─────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    audit('voice_started')
    onRecordingStateChange?.(true)
    await start()
  }, [start, onRecordingStateChange, audit])

  // ── キャンセル（録音中） ──────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    audit('voice_cancelled')
    fullReset()
  }, [fullReset, audit])

  // ── 停止 ─────────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    stop()
    // postPhase は status==='stopped' を受けて useEffect が 'confirming' へ遷移
  }, [stop])

  // ── ② 確認画面: 破棄 ────────────────────────────────────────────────────
  const handleDiscard = useCallback(() => {
    audit('voice_discarded')
    fullReset()
  }, [fullReset, audit])

  // ── 確認画面: 編集へ ─────────────────────────────────────────────────────
  const handleEditStart = useCallback(() => {
    setEditBuffer(transcript)
    setPostPhase('editing')
  }, [transcript])

  // ── ③ 編集確定 ────────────────────────────────────────────────────────────
  const handleEditDone = useCallback(() => {
    setTranscript(editBuffer)
    setPostPhase('confirming')
  }, [editBuffer])

  // ── 確認画面: 保存フローへ ────────────────────────────────────────────────
  const handleProceedSave = useCallback(() => {
    const notes = extractCustomerNotes(transcript, null)
    const cands: MemoryCandidate[] = notes.map((n, i) => ({
      idx:        i,
      content:    n.content,
      memoryType: CATEGORY_TO_MEMORY_TYPE[n.category] ?? 'other',
    }))
    setCandidates(cands)
    setCheckedSet(new Set(cands.map(c => c.idx)))   // 全選択をデフォルト
    setPostPhase('selecting')
  }, [transcript])

  // ── ④ チェックボックス切り替え ───────────────────────────────────────────
  const toggleCheck = useCallback((idx: number) => {
    setCheckedSet(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  // ── Undo（5秒 toast から呼ばれる） ───────────────────────────────────────
  const handleUndo = useCallback(async () => {
    const saved = savedRef.current
    if (!saved) return
    savedRef.current = null

    await deleteVoiceNote(saved.voiceNoteId, saved.storagePath)

    for (const memId of saved.memoryIds) {
      await authedFetch(
        `/api/customer-memories/${memId}?customer_id=${encodeURIComponent(customerId)}`,
        { method: 'DELETE' }
      )
    }

    audit('voice_undo', {
      voice_note_id: saved.voiceNoteId,
      memory_count:  saved.memoryIds.length,
    })
    void loadNotes()
    onSaved()
  }, [customerId, audit, loadNotes, onSaved])

  // ── 確定保存（Storage + voice_notes + customer_memories） ────────────────
  const handleConfirmSave = useCallback(async () => {
    if (!audioBlob || !staffId || isSaving) return
    setIsSaving(true)
    setPostPhase('saving')

    try {
      // 1. Storage + voice_notes INSERT
      const { voiceNoteId, storagePath, error: upErr } = await uploadVoiceNote({
        blob:          audioBlob,
        staffId,
        customerId,
        reservationId,
        durationSec:   durRef.current,
      })

      if (upErr || !voiceNoteId || !storagePath) {
        prodLog('warn', '[VoiceMemoSection] upload失敗', upErr)
        toast.error('保存に失敗しました。もう一度お試しください。')
        setPostPhase('selecting')
        setIsSaving(false)
        return
      }

      // 2. 選択したメモリだけ customer_memories へ保存
      const memoryIds: string[] = []
      for (const cand of candidates) {
        if (!checkedSet.has(cand.idx)) continue
        try {
          const res = await authedFetch('/api/customer-memories', {
            method: 'POST',
            body: JSON.stringify({
              customer_id:  customerId,
              content:      cand.content,
              memory_type:  cand.memoryType,
              importance:   'medium',
              is_sensitive: false,
              created_by:   staffId,
            }),
          })
          if (res.ok) {
            const { memory } = await res.json() as { memory: { id: string } }
            memoryIds.push(memory.id)
          }
        } catch { /* silent: 1件失敗しても続行 */ }
      }

      // 3. 監査ログ
      audit('voice_saved', {
        voice_note_id: voiceNoteId,
        memory_count:  memoryIds.length,
        duration_sec:  durRef.current,
      })

      // 4. Undo 用に ref に保存
      savedRef.current = { voiceNoteId, storagePath, memoryIds }

      // 5. リセット
      fullReset()

      // 6. 5秒 Undo toast
      toast.success('保存しました', {
        duration: 5000,
        action: {
          label:   '取り消す',
          onClick: () => { void handleUndo() },
        },
      })

      // 7. 後処理
      void loadNotes()
      onSaved()
      setTimeout(() => {
        onSuggestion?.('音声メモを保存しました — Customer Memory を更新しました ✦')
      }, 800)

    } catch (e) {
      prodLog('error', '[VoiceMemoSection] 保存失敗', e)
      toast.error('保存に失敗しました')
      setPostPhase('selecting')
      setIsSaving(false)
    }
  }, [
    audioBlob, staffId, customerId, reservationId,
    candidates, checkedSet, isSaving,
    audit, fullReset, loadNotes, onSaved, onSuggestion, handleUndo,
  ])

  // ── 過去メモ再生 ──────────────────────────────────────────────────────────
  const handlePlay = useCallback(async (note: VoiceNoteRow) => {
    if (playingId === note.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    const url = await getVoiceNoteUrl(note.storage_path)
    if (!url) { toast.error('音声の読み込みに失敗しました'); return }
    if (audioRef.current) audioRef.current.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => { toast.error('再生に失敗しました'); setPlayingId(null) }
    audio.play().catch(() => { toast.error('再生に失敗しました'); setPlayingId(null) })
    setPlayingId(note.id)
  }, [playingId])

  const handleDeleteNote = useCallback(async (note: VoiceNoteRow) => {
    if (deletingId) return
    setDeletingId(note.id)
    if (playingId === note.id) { audioRef.current?.pause(); setPlayingId(null) }
    const { error } = await deleteVoiceNote(note.id, note.storage_path)
    setDeletingId(null)
    if (error) { toast.error('削除に失敗しました'); return }
    toast.success('音声メモを削除しました', { duration: 1500 })
    await loadNotes()
  }, [deletingId, playingId, loadNotes])

  // ── ヘルパー ──────────────────────────────────────────────────────────────
  const fmtSec = (s: number) => {
    const m = Math.floor(s / 60); const r = s % 60
    return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${s}秒`
  }

  const isPost = status === 'stopped' && postPhase !== null

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: '#F0F5FA', borderRadius: '22px', padding: '16px' }}>
      <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#4878A8', fontWeight: 600, marginBottom: '12px' }}>
        🎙️ 音声メモ
      </p>

      <div style={{ background: '#fff', borderRadius: '18px', padding: '14px', border: '1px solid #C8DCF0', marginBottom: '12px' }}>

        {errorMessage && (
          <p style={{ fontSize: '12px', color: '#C05060', marginBottom: '10px', lineHeight: 1.5 }}>
            ⚠️ {errorMessage}
          </p>
        )}

        <AnimatePresence mode="wait">

          {/* ── idle / error ── */}
          {!isPost && (status === 'idle' || status === 'error') && (
            <motion.div key="idle"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {status === 'error' ? (
                <button onClick={reset}
                  style={{ ...pill('#fff', '#688098', '#C8DCF0'), width: '100%' }}>
                  もう一度試す
                </button>
              ) : (
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={handleStart} onTouchStart={handleStart}
                  style={{
                    ...pill('#4878A8', '#fff'),
                    width: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: '8px',
                    touchAction: 'none', WebkitTapHighlightColor: 'transparent',
                  }}>
                  <span style={{ fontSize: '18px' }}>🎙️</span> 録音を開始
                </motion.button>
              )}
            </motion.div>
          )}

          {/* ── requesting ── */}
          {!isPost && status === 'requesting' && (
            <motion.div key="requesting"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: '13px', color: '#4878A8' }}>マイクの許可を確認中…</p>
            </motion.div>
          )}

          {/* ── ① 録音中: キャンセル + 停止 ── */}
          {!isPost && status === 'recording' && (
            <motion.div key="recording"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* 波形 + タイマー */}
              <motion.div
                animate={{ boxShadow: ['0 0 0px rgba(232,64,80,0)', '0 0 14px rgba(232,64,80,0.14)', '0 0 0px rgba(232,64,80,0)'] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{ borderRadius: '14px', padding: '12px', background: 'rgba(232,64,80,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '28px' }}>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <motion.div key={i}
                      animate={{ height: ['4px', `${12 + Math.sin(i * 0.8) * 10}px`, '4px'] }}
                      transition={{ duration: 0.6 + i * 0.07, repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }}
                      style={{ width: '3px', borderRadius: '999px', background: '#E84050' }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <motion.div
                    animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                    style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E84050', flexShrink: 0 }}
                  />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '22px', fontWeight: 700, color: '#4878A8', letterSpacing: '0.04em' }}>
                    {fmtSec(durationSec)}
                  </span>
                </div>
              </motion.div>

              {/* キャンセル + 停止 ボタン行 */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleCancel}
                  style={{ ...pill('#FFF5F6', '#C05060', '#F5C0C8'), flex: 1 }}>
                  キャンセル
                </button>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={handleStop} onTouchStart={handleStop}
                  style={{
                    ...pill('#E84050', '#fff'),
                    flex: 2, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: '8px',
                    touchAction: 'none', WebkitTapHighlightColor: 'transparent',
                  }}>
                  <span style={{ fontSize: '16px' }}>⏹</span> 停止
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── ② 確認画面: 音声再生 + transcript + 3ボタン ── */}
          {isPost && postPhase === 'confirming' && (
            <motion.div key="confirming"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* 録音時間バッジ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#4878A8', fontWeight: 600 }}>録音完了</span>
                <span style={{ fontSize: '11px', color: '#688098', background: '#E0EAF5', padding: '2px 8px', borderRadius: '999px' }}>
                  {fmtSec(durationSec)}
                </span>
              </div>

              {/* 音声再生 */}
              {audioUrl && (
                <audio
                  src={audioUrl}
                  controls
                  preload="none"
                  style={{ width: '100%', height: '36px', outline: 'none', borderRadius: '8px' }}
                />
              )}

              {/* transcript 全文 */}
              <div style={{ background: '#F0F5FA', borderRadius: '10px', padding: '10px' }}>
                <p style={{ fontSize: '10px', color: '#8AAAC8', letterSpacing: '0.1em', marginBottom: '4px' }}>
                  文字起こし {transcriptLoading ? '（解析中…）' : ''}
                </p>
                {transcriptLoading && !transcript ? (
                  <motion.p
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                    style={{ fontSize: '11px', color: '#8AAAC8' }}>
                    解析中…
                  </motion.p>
                ) : (
                  <p style={{ fontSize: '12px', color: '#4878A8', lineHeight: 1.7, wordBreak: 'break-all' }}>
                    {transcript || '（文字起こし結果なし）'}
                  </p>
                )}
              </div>

              {/* 破棄 / 編集 / 保存へ */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={handleDiscard}
                  style={{ ...pill('#FFF5F6', '#C05060', '#F5C0C8'), flex: 1 }}>
                  破棄
                </button>
                <button onClick={handleEditStart}
                  style={{ ...pill('#fff', '#688098', '#C8DCF0'), flex: 1 }}>
                  編集
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleProceedSave}
                  style={{ ...pill('#4878A8', '#fff'), flex: 2 }}>
                  保存へ
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── ③ 編集: transcript 修正 ── */}
          {isPost && postPhase === 'editing' && (
            <motion.div key="editing"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ fontSize: '11px', color: '#8AAAC8', letterSpacing: '0.1em' }}>
                📝 文字起こしを修正
              </p>
              <textarea
                value={editBuffer}
                onChange={e => setEditBuffer(e.target.value)}
                rows={5}
                autoFocus
                style={{
                  width: '100%', fontSize: '12px', color: '#4878A8', lineHeight: 1.7,
                  padding: '10px', borderRadius: '10px',
                  border: '1.5px solid rgba(72,120,168,0.35)',
                  background: '#FAFCFF', outline: 'none', resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setPostPhase('confirming')}
                  style={{ ...pill('#fff', '#688098', '#C8DCF0'), flex: 1 }}>
                  キャンセル
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleEditDone}
                  style={{ ...pill('#4878A8', '#fff'), flex: 2 }}>
                  確定
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── ④ 選択保存: チェックボックス ── */}
          {isPost && postPhase === 'selecting' && (
            <motion.div key="selecting"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              <div>
                <p style={{ fontSize: '12px', color: '#4878A8', fontWeight: 600, marginBottom: '4px' }}>
                  保存するメモリを選択
                </p>
                <p style={{ fontSize: '10px', color: '#8AAAC8' }}>
                  チェックしたものだけ保存されます
                </p>
              </div>

              {candidates.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#8AAAC8', textAlign: 'center', padding: '8px 0' }}>
                  メモリ候補が見つかりませんでした
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {candidates.map(c => (
                    <label key={c.idx}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checkedSet.has(c.idx)}
                        onChange={() => toggleCheck(c.idx)}
                        style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: '#4878A8', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '12px', color: '#3d4858', lineHeight: 1.6 }}>
                        {c.content}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setPostPhase('confirming')}
                  style={{ ...pill('#fff', '#688098', '#C8DCF0'), flex: 1 }}>
                  戻る
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleConfirmSave}
                  disabled={isSaving}
                  style={{ ...pill(isSaving ? '#A0BCD8' : '#4878A8', '#fff'), flex: 2, cursor: isSaving ? 'default' : 'pointer' }}>
                  {isSaving ? '保存中…' : `保存（${checkedSet.size}件）`}
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── saving スピナー ── */}
          {isPost && postPhase === 'saving' && (
            <motion.div key="saving"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ textAlign: 'center', padding: '20px 0' }}>
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                style={{ fontSize: '20px', color: '#4878A8' }}>✦</motion.span>
              <p style={{ fontSize: '12px', color: '#4878A8', marginTop: '8px' }}>保存中…</p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── 過去メモ一覧 ── */}
      <VoiceNotesList
        notes={pastNotes}
        loading={notesLoading}
        playingId={playingId}
        deletingId={deletingId}
        onPlay={handlePlay}
        onDelete={handleDeleteNote}
      />
    </div>
  )
})

VoiceMemoSectionInner.displayName = 'VoiceMemoSection'
export default VoiceMemoSectionInner

'use client'
/**
 * VoiceMemoSection.tsx
 * CustomerBottomSheet 内の音声メモセクション。
 * 録音・再生・削除・保存をモバイル優先UIで実装。
 * 既存デザイントークン（色・余白）を完全踏襲。
 */
import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { prodLog } from '@/lib/stability'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import {
  uploadVoiceNote,
  fetchVoiceNotes,
  deleteVoiceNote,
  getVoiceNoteUrl,
  formatDuration,
  type VoiceNoteRow,
} from '@/lib/voiceNote'
import { INSIGHT_TAG_LABELS } from '@/types'
import {
  runStreamPipeline,
  StreamPipelineController,
  type PartialTranscript,
  type StreamingInsight,
} from '@/lib/voice/streamPipeline'
import type { InsightTag } from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface VoiceMemoSectionProps {
  customerId:    string
  staffId:       string | null
  reservationId: string | null
  /** 保存完了後に親の行動履歴をリロードさせるコールバック */
  onSaved:       () => void
  /** Silent Automation 完了後のサジェスト（任意） */
  onSuggestion?: (hint: string) => void
  /** 録音状態が変化した時の通知（STEP7: Adaptive Priority 連携） */
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
}: VoiceMemoSectionProps) {
  const {
    status, durationSec, audioBlob, audioUrl, errorMessage,
    start, stop, reset,
  } = useVoiceRecorder()

  const [uploading,          setUploading]          = useState(false)
  // STEP5: partial transcript / streaming insight 表示
  const [partialTranscript,  setPartialTranscript]  = useState<string>('')
  const [streamingTags,      setStreamingTags]      = useState<string[]>([])
  const [processingStage,    setProcessingStage]    = useState<'idle' | 'analyzing' | 'done'>('idle')
  const pipelineCtrlRef = useRef<StreamPipelineController | null>(null)
  const [pastNotes,    setPastNotes]    = useState<VoiceNoteRow[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [playingId,    setPlayingId]    = useState<string | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // 過去メモをロード
  const loadNotes = useCallback(async () => {
    setNotesLoading(true)
    const rows = await fetchVoiceNotes(customerId, 5)
    setPastNotes(rows)
    setNotesLoading(false)
  }, [customerId])

  useEffect(() => {
    loadNotes()
  }, [loadNotes])

  // アンマウント時 audio 解放 + pipeline キャンセル
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      pipelineCtrlRef.current?.cancel()
    }
  }, [])

  // ── 録音開始/停止ラッパー（STEP7: Adaptive Priority 通知） ─────────────────────
  const handleStart = useCallback(async () => {
    setPartialTranscript('')
    setStreamingTags([])
    setProcessingStage('idle')
    onRecordingStateChange?.(true)
    await start()
  }, [start, onRecordingStateChange])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleStop = useCallback(() => {
    stop()
    onRecordingStateChange?.(false)
  }, [stop, onRecordingStateChange])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 保存 ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!audioBlob || !staffId || uploading) return
    setUploading(true)

    setProcessingStage('analyzing')
    pipelineCtrlRef.current?.cancel()
    pipelineCtrlRef.current = new StreamPipelineController()

    const { error } = await uploadVoiceNote({
      blob:          audioBlob,
      staffId,
      customerId,
      reservationId,
      durationSec,
    })

    setUploading(false)

    if (error) {
      setProcessingStage('idle')
      prodLog('warn', '[VoiceMemoSection] 保存失敗 — silent fallback')
      return
    }

    // STEP4: streaming pipeline で段階的にinsightを表示
    if (audioBlob) {
      void runStreamPipeline(
        { audioBlob, durationSec },
        {
          onPartialTranscript: (pt: PartialTranscript) => {
            setPartialTranscript(pt.text)
          },
          onStreamingInsight: (si: StreamingInsight) => {
            if (si.tags.length > 0) setStreamingTags(si.tags)
          },
          onComplete: () => {
            setProcessingStage('done')
            // 分析完了をリロードで反映
            void loadNotes()
          },
          onError: (_err, fallback) => {
            setProcessingStage('done')
            if (fallback.tags.length > 0) setStreamingTags(fallback.tags)
          },
        },
        {},
        pipelineCtrlRef.current ?? undefined
      )
    }

    toast.success('音声メモを保存しました 🎙️', { duration: 2000 })
    reset()
    await loadNotes()
    onSaved()

    // Silent Automation ヒント
    setTimeout(() => {
      onSuggestion?.('音声メモを分析しました — NextActionが更新されました ✦')
    }, 800)
  }, [audioBlob, staffId, customerId, reservationId, durationSec, uploading, reset, loadNotes, onSaved, onSuggestion]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 過去メモ再生 ─────────────────────────────────────────────────────────
  const handlePlay = useCallback(async (note: VoiceNoteRow) => {
    // 同一メモ再生中なら停止
    if (playingId === note.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }

    const url = await getVoiceNoteUrl(note.storage_path)
    if (!url) {
      toast.error('音声の読み込みに失敗しました')
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => { toast.error('再生に失敗しました'); setPlayingId(null) }
    audio.play()
    setPlayingId(note.id)
  }, [playingId])

  // ── 過去メモ削除 ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (note: VoiceNoteRow) => {
    if (deletingId) return
    setDeletingId(note.id)

    if (playingId === note.id) {
      audioRef.current?.pause()
      setPlayingId(null)
    }

    const { error } = await deleteVoiceNote(note.id, note.storage_path)
    setDeletingId(null)

    if (error) {
      toast.error('削除に失敗しました')
      return
    }

    toast.success('音声メモを削除しました', { duration: 1500 })
    await loadNotes()
  }, [deletingId, playingId, loadNotes])

  // ── 秒数フォーマット ──────────────────────────────────────────────────────
  const formatSec = (s: number) => {
    const m = Math.floor(s / 60)
    const r = s % 60
    return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${s}秒`
  }

  // ── レンダー ─────────────────────────────────────────────────────────────

  return (
    <div style={{ background: '#F0F5FA', borderRadius: '22px', padding: '16px' }}>
      <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#4878A8', fontWeight: 600, marginBottom: '12px' }}>
        🎙️ 音声メモ
      </p>

      {/* ── 録音コントロール ── */}
      <div style={{ background: '#fff', borderRadius: '18px', padding: '14px', border: '1px solid #C8DCF0', marginBottom: '12px' }}>

        {/* エラー */}
        {errorMessage && (
          <p style={{ fontSize: '12px', color: '#C05060', marginBottom: '10px', lineHeight: 1.5 }}>
            ⚠️ {errorMessage}
          </p>
        )}

        {/* idle: 録音開始ボタン */}
        {status === 'idle' && (
          <motion.button whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            onTouchStart={handleStart}
            style={{ width: '100%', padding: '14px', borderRadius: '999px', border: 'none', background: '#4878A8', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}>
            <span style={{ fontSize: '18px' }}>🎙️</span> 録音を開始
          </motion.button>
        )}

        {/* requesting: マイク許可待ち */}
        {status === 'requesting' && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <p style={{ fontSize: '13px', color: '#4878A8' }}>マイクの許可を確認中…</p>
          </div>
        )}

        {/* recording: 録音中 */}
        {status === 'recording' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Recording glow + indicator */}
            <motion.div
              animate={{ boxShadow: ['0 0 0px rgba(232,64,80,0)', '0 0 14px rgba(232,64,80,0.14)', '0 0 0px rgba(232,64,80,0)'] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ borderRadius: '14px', padding: '12px', background: 'rgba(232,64,80,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}
            >
              {/* 波形バー */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '28px' }}>
                {Array.from({ length: 9 }).map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: ['4px', `${12 + Math.sin(i * 0.8) * 10}px`, '4px'] }}
                    transition={{ duration: 0.6 + i * 0.07, repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }}
                    style={{ width: '3px', borderRadius: '999px', background: '#E84050' }}
                  />
                ))}
              </div>
              {/* タイマー */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <motion.div
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E84050', flexShrink: 0 }}
                />
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '22px', fontWeight: 700, color: '#4878A8', letterSpacing: '0.04em' }}>
                  {formatSec(durationSec)}
                </span>
              </div>
            </motion.div>
            <motion.button whileTap={{ scale: 0.97 }}
              onClick={handleStop}
              onTouchStart={handleStop}
              style={{ width: '100%', padding: '14px', borderRadius: '999px', border: 'none', background: '#E84050', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}>
              <span style={{ fontSize: '16px' }}>⏹</span> 録音を停止
            </motion.button>
          </div>
        )}

        {/* stopped: 録音完了 → 確認UI */}
        {status === 'stopped' && audioUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 録音時間バッジ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#4878A8', fontWeight: 600 }}>
                録音完了
              </span>
              <span style={{ fontSize: '11px', color: '#688098', background: '#E0EAF5', padding: '2px 8px', borderRadius: '999px' }}>
                {formatSec(durationSec)}
              </span>
            </div>

            {/* STEP5: partial transcript 表示（静かに・フェードイン） */}
            {partialTranscript && processingStage !== 'idle' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                style={{ background: '#F0F5FA', borderRadius: '10px', padding: '8px 10px' }}
              >
                <p style={{ fontSize: '10px', color: '#8AAAC8', letterSpacing: '0.1em', marginBottom: '3px' }}>文字起こし</p>
                <p style={{ fontSize: '11px', color: '#4878A8', lineHeight: 1.6, wordBreak: 'break-all' }}>
                  {partialTranscript}
                </p>
              </motion.div>
            )}

            {/* STEP5: streaming insight tags（段階表示） */}
            {streamingTags.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}
              >
                {streamingTags.slice(0, 3).map((tag, i) => (
                  <motion.span
                    key={tag}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06, duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '999px', background: '#E8F0FA', color: '#4878A8', fontWeight: 500, border: '1px solid rgba(72,120,168,0.2)' }}
                  >
                    {INSIGHT_TAG_LABELS[tag as InsightTag] ?? tag}
                  </motion.span>
                ))}
              </motion.div>
            )}

            {/* STEP5: processing shimmer（AI分析中の静かな表現） */}
            {processingStage === 'analyzing' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 2px' }}
              >
                <motion.span
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ fontSize: '10px', color: '#8AAAC8' }}
                >
                  ✦
                </motion.span>
                <p style={{ fontSize: '11px', color: '#8AAAC8' }}>分析中…</p>
              </motion.div>
            )}

            {/* ブラウザネイティブ再生コントロール */}
            <audio
              src={audioUrl}
              controls
              preload="metadata"
              style={{ width: '100%', height: '36px', outline: 'none', borderRadius: '8px' }}
            />

            {/* 保存 / 撮り直し */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={reset}
                style={{ flex: 1, padding: '11px', borderRadius: '999px', border: '1.5px solid #C8DCF0', background: '#fff', color: '#688098', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                撮り直し
              </button>
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={handleSave}
                disabled={uploading}
                style={{ flex: 2, padding: '11px', borderRadius: '999px', border: 'none', background: uploading ? '#A0BCD8' : '#4878A8', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: uploading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                {uploading ? (
                  <>
                    <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.9, repeat: Infinity }}>✦</motion.span>
                    AI分析中…
                  </>
                ) : '保存する'}
              </motion.button>
            </div>
          </div>
        )}

        {/* error: リトライ */}
        {status === 'error' && (
          <button onClick={reset}
            style={{ width: '100%', padding: '12px', borderRadius: '999px', border: '1.5px solid #C8DCF0', background: '#fff', color: '#688098', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            もう一度試す
          </button>
        )}
      </div>

      {/* ── 過去メモ一覧 ── */}
      {notesLoading ? (
        <p style={{ fontSize: '12px', color: '#A0BCD8', textAlign: 'center', padding: '4px 0' }}>読み込み中…</p>
      ) : pastNotes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
          <div style={{ fontSize: '18px', marginBottom: '5px', opacity: 0.35 }}>🎙️</div>
          <p style={{ fontSize: '12px', color: '#A0BCD8', lineHeight: 1.6 }}>
            音声メモはありません<br/>
            <span style={{ fontSize: '11px', color: '#B8D0E0' }}>接客後に録音すると自動でAI分析されます</span>
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {pastNotes.map(note => {
            const isPlaying  = playingId === note.id
            const isDeleting = deletingId === note.id
            return (
              <div key={note.id}
                style={{ background: '#fff', borderRadius: '14px', padding: '10px 12px', border: '1px solid #C8DCF0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* 再生ボタン */}
                <button onClick={() => handlePlay(note)}
                  style={{ width: '34px', height: '34px', borderRadius: '50%', border: 'none', background: isPlaying ? '#E84050' : '#4878A8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: '14px' }}>
                  {isPlaying ? '⏸' : '▶'}
                </button>

                {/* メタ情報 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '11px', color: '#4878A8', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>
                    {note.displayAt}
                  </p>
                  {note.duration_sec !== null && (
                    <p style={{ fontSize: '10px', color: '#A0BCD8' }}>
                      {formatDuration(note.duration_sec)}
                    </p>
                  )}
                  {note.summary && (
                    <p style={{ fontSize: '11px', color: '#688098', marginTop: '2px', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                      {note.summary}
                    </p>
                  )}
                  {/* PHASE3: insight_tags 表示 */}
                  {note.insight_tags && note.insight_tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                      {(note.insight_tags as InsightTag[]).slice(0, 3).map(tag => (
                        <span key={tag} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', background: '#E8F0FA', color: '#4878A8', fontWeight: 500 }}>
                          {INSIGHT_TAG_LABELS[tag] ?? tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 削除ボタン */}
                <button onClick={() => handleDelete(note)}
                  disabled={isDeleting}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', border: 'none', background: '#F8F0F0', color: '#C07080', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isDeleting ? 'default' : 'pointer', flexShrink: 0, fontSize: '13px', opacity: isDeleting ? 0.5 : 1 }}>
                  {isDeleting ? '…' : '×'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

VoiceMemoSectionInner.displayName = 'VoiceMemoSection'

export default VoiceMemoSectionInner
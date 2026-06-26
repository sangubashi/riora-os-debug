'use client'
/**
 * useVoiceRecorder.ts
 * MediaRecorder API ラッパー。iPhone Safari 対応。
 *
 * 状態遷移: idle → recording → stopped → idle
 * iPhone Safari では audio/mp4 を優先。
 * getUserMedia は 'use client' 環境でのみ動作。
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { getSupportedMimeType } from '@/lib/voiceNote'

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error'

// 録音は最大30秒で自動停止する
const MAX_RECORDING_SEC = 30

export interface UseVoiceRecorderReturn {
  status:       RecorderStatus
  durationSec:  number
  audioBlob:    Blob | null
  audioUrl:     string | null   // Object URL（ローカル再生用）
  errorMessage: string | null
  start:        () => Promise<void>
  stop:         () => void
  reset:        () => void
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [status,      setStatus]      = useState<RecorderStatus>('idle')
  const [durationSec, setDurationSec] = useState(0)
  const [audioBlob,   setAudioBlob]   = useState<Blob | null>(null)
  const [audioUrl,    setAudioUrl]    = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef        = useRef<Blob[]>([])
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const objectUrlRef     = useRef<string | null>(null)

  // タイマー停止
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // ストリーム解放
  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // ObjectURL 解放
  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  // アンマウント時クリーンアップ
  useEffect(() => {
    return () => {
      stopTimer()
      releaseStream()
      releaseObjectUrl()
    }
  }, [stopTimer, releaseStream, releaseObjectUrl])

  // 録音開始
  const start = useCallback(async () => {
    setStatus('requesting')
    setErrorMessage(null)
    chunksRef.current = []

    // getUserMedia
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate:       44100,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'マイクへのアクセスが拒否されました'
      setStatus('error')
      setErrorMessage(msg)
      return
    }

    streamRef.current = stream

    const mimeType = getSupportedMimeType()
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch {
      // mimeType 指定でエラーならデフォルトで再試行
      try {
        recorder = new MediaRecorder(stream)
      } catch (e2) {
        const msg = e2 instanceof Error ? e2.message : '録音を開始できませんでした'
        setStatus('error')
        setErrorMessage(msg)
        releaseStream()
        return
      }
    }

    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    recorder.onstop = () => {
      stopTimer()
      releaseStream()

      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType,
      })
      releaseObjectUrl()
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url

      setAudioBlob(blob)
      setAudioUrl(url)
      setStatus('stopped')
    }

    recorder.onerror = () => {
      stopTimer()
      releaseStream()
      setStatus('error')
      setErrorMessage('録音中にエラーが発生しました')
    }

    // タイマー開始（最大 MAX_RECORDING_SEC 秒で自動停止）
    setDurationSec(0)
    timerRef.current = setInterval(() => {
      setDurationSec(prev => {
        const next = prev + 1
        if (next >= MAX_RECORDING_SEC && mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop()
        }
        return next
      })
    }, 1000)

    recorder.start(200) // 200ms ごとにチャンクを生成（iPhone 対応）
    setStatus('recording')
  }, [stopTimer, releaseStream, releaseObjectUrl])

  // 録音停止
  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    stopTimer()
  }, [stopTimer])

  // リセット
  const reset = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    stopTimer()
    releaseStream()
    releaseObjectUrl()

    setStatus('idle')
    setDurationSec(0)
    setAudioBlob(null)
    setAudioUrl(null)
    setErrorMessage(null)
    chunksRef.current = []
    mediaRecorderRef.current = null
  }, [stopTimer, releaseStream, releaseObjectUrl])

  return {
    status,
    durationSec,
    audioBlob,
    audioUrl,
    errorMessage,
    start,
    stop,
    reset,
  }
}

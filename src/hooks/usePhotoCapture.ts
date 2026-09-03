'use client'
/**
 * usePhotoCapture.ts
 * 撮影画面(PhotoCaptureView)向けのReactバインディング。
 *
 * カメラ起動(getUserMedia)・ゴースト取得・シャッター確定フローを束ねる薄いフック。
 * ビジネスロジック本体は src/lib/photos/*.ts の純粋関数/クラスに委譲する
 * (src/hooks/useVoiceRecorder.ts・useVoiceMemoFlow.ts と同じ設計思想)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CaptureConfirmSession,
  type CaptureConfirmPhase,
  type CapturePhotoType,
} from '@/lib/photos/captureConfirmFlow'
import { captureVideoFrameToBlob } from '@/lib/photos/captureFrame'
import { classifyCameraError, type CameraErrorKind } from '@/lib/photos/cameraError'
import {
  selectGhostForAfter,
  selectGhostForBefore,
  type GhostPhotoResult,
} from '@/lib/photos/ghostSelection'
import {
  createPhotoListFetcher,
  createUploadPhotoFn,
  getPhotoSignedUrl,
} from '@/lib/photos/photoApiClient'
import { convertImageFileToWebpBlob } from '@/lib/photos/fileToWebpBlob'

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error'
export type GhostOpacityLevel = 'off' | 'weak' | 'strong'

export const GHOST_OPACITY_VALUE: Record<GhostOpacityLevel, number> = {
  off:    0,
  weak:   0.25,
  strong: 0.5,
}

const GHOST_OPACITY_STORAGE_KEY = 'riora.photoKarte.ghostOpacity'

export interface UsePhotoCaptureOptions {
  customerId:      string
  visitId:         string | null
  initialBodyPart: string
}

function isGhostOpacityLevel(v: string | null): v is GhostOpacityLevel {
  return v === 'off' || v === 'weak' || v === 'strong'
}

export function usePhotoCapture(options: UsePhotoCaptureOptions) {
  const { customerId, visitId } = options

  const videoRef       = useRef<HTMLVideoElement | null>(null)
  const streamRef       = useRef<MediaStream | null>(null)
  const sessionRef       = useRef<CaptureConfirmSession | null>(null)
  const previewUrlRef    = useRef<string | null>(null)

  const [cameraStatus, setCameraStatus]       = useState<CameraStatus>('idle')
  const [cameraErrorKind, setCameraErrorKind] = useState<CameraErrorKind | null>(null)

  const [bodyPart, setBodyPart]   = useState(options.initialBodyPart)
  const [photoType, setPhotoType] = useState<CapturePhotoType>('before')

  const [ghost, setGhost]               = useState<GhostPhotoResult | null>(null)
  const [ghostUrl, setGhostUrl]         = useState<string | null>(null)
  const [ghostLoading, setGhostLoading] = useState(false)

  const [ghostOpacityLevel, setGhostOpacityLevelState] = useState<GhostOpacityLevel>('weak')

  const [reviewPhase, setReviewPhase] = useState<CaptureConfirmPhase>('idle')
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [justSaved, setJustSaved]     = useState(false)

  // ── 直前に選んだゴースト濃さをlocalStorageから復元(1-5節、失敗しても既定値のまま) ──
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GHOST_OPACITY_STORAGE_KEY)
      if (isGhostOpacityLevel(saved)) setGhostOpacityLevelState(saved)
    } catch {
      // localStorage不可の環境(プライベートモード等)は既定値のまま進める
    }
  }, [])

  const setGhostOpacityLevel = useCallback((level: GhostOpacityLevel) => {
    setGhostOpacityLevelState(level)
    try {
      window.localStorage.setItem(GHOST_OPACITY_STORAGE_KEY, level)
    } catch {
      // 保存できなくても致命的ではない
    }
  }, [])

  // ── カメラ起動/停止 ──────────────────────────────────────────────────────
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setCameraStatus('requesting')
    setCameraErrorKind(null)

    const mediaDevicesAvailable =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'

    if (!mediaDevicesAvailable) {
      setCameraStatus('error')
      setCameraErrorKind(classifyCameraError(null, false))
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraStatus('ready')
    } catch (err) {
      releaseStream()
      setCameraStatus('error')
      setCameraErrorKind(classifyCameraError(err, true))
    }
  }, [releaseStream])

  const stopCamera = useCallback(() => {
    releaseStream()
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraStatus('idle')
  }, [releaseStream])

  useEffect(() => {
    return () => {
      // 必須修正1: レビュー中(1.5秒以内)に画面を閉じた場合、CaptureConfirmSessionに
      // 残っている保留中の自動確定タイマーを「撮り直す」と同じ扱いで確実にキャンセルする。
      // これによりPOSTは発火せず、session内のBlob参照も破棄される(1-8-1節3b相当)。
      sessionRef.current?.retake()
      releaseStream()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [releaseStream])

  // ── ゴースト取得(bodyPart/photoType/visitId変化のたびに再取得) ─────────────
  useEffect(() => {
    let cancelled = false
    setGhost(null)
    setGhostUrl(null)

    if (!bodyPart) return undefined

    setGhostLoading(true)
    const fetcher = createPhotoListFetcher(customerId)
    const select  = photoType === 'after' ? selectGhostForAfter : selectGhostForBefore

    select(fetcher, { customerId, bodyPart, currentVisitId: visitId })
      .then(async (result) => {
        if (cancelled) return
        setGhost(result)
        if (result) {
          const url = await getPhotoSignedUrl(customerId, result.photo.id, 'thumbnail')
          if (!cancelled) setGhostUrl(url)
        }
      })
      .catch(() => {
        if (!cancelled) setGhost(null)
      })
      .finally(() => {
        if (!cancelled) setGhostLoading(false)
      })

    return () => { cancelled = true }
  }, [customerId, visitId, bodyPart, photoType])

  // ── シャッター確定フロー(captureConfirmFlow.tsへ委譲) ──────────────────────
  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }, [])

  const ensureSession = useCallback((): CaptureConfirmSession => {
    if (!sessionRef.current) {
      sessionRef.current = new CaptureConfirmSession({
        setTimer:   (cb, ms) => window.setTimeout(cb, ms),
        clearTimer: (h) => window.clearTimeout(h as ReturnType<typeof window.setTimeout>),
        generateClientRequestId: () => crypto.randomUUID(),
        uploadPhoto: async (payload) => {
          // 1-8-1節: 自動確定と同時にPOSTの完了を待たず画面遷移させる。
          // ここでの状態更新が「即座の画面復帰」に相当する(ネットワークはこの後バックグラウンドで進む)。
          setReviewPhase('confirmed')
          clearPreview()
          try {
            const uploadFn = createUploadPhotoFn(customerId)
            await uploadFn(payload)
            setUploadError(null)
            // 必須修正2: 成功をスタッフに分かる形で示す(次の撮影開始時にクリアされる)。
            setJustSaved(true)
          } catch (e) {
            // 1-8-2節: 通信失敗時も他の部位の撮影をブロックしない(高度な自動リトライUIは今回スコープ外)。
            setUploadError(e instanceof Error ? e.message : 'upload_failed')
            setJustSaved(false)
          }
        },
      })
    }
    return sessionRef.current
  }, [customerId, clearPreview])

  /** unsupported_webp_encoding系のエラーかどうかを判定する(必須修正4)。 */
  const isUnsupportedWebpError = (e: unknown): boolean =>
    e instanceof Error && e.message.startsWith('unsupported_webp_encoding')

  const beginReview = useCallback((blob: Blob) => {
    clearPreview()
    const url = URL.createObjectURL(blob)
    previewUrlRef.current = url
    setPreviewUrl(url)
    setUploadError(null)
    setJustSaved(false)
    setReviewPhase('reviewing')

    ensureSession().capture({ blob, bodyPart, photoType, visitId })
  }, [bodyPart, photoType, visitId, ensureSession, clearPreview])

  const shutter = useCallback(async () => {
    if (reviewPhase === 'reviewing') return // 二重シャッター防止
    if (!videoRef.current || cameraStatus !== 'ready') return

    const video = videoRef.current
    try {
      const blob = await captureVideoFrameToBlob(
        { element: video, width: video.videoWidth, height: video.videoHeight },
        {
          createCanvas: () => document.createElement('canvas'),
          canvasToBlob: (canvas, mimeType, quality) =>
            new Promise<Blob>((resolve, reject) => {
              (canvas as unknown as HTMLCanvasElement).toBlob(
                (b) => (b ? resolve(b) : reject(new Error('canvas_to_blob_failed'))),
                mimeType,
                quality
              )
            }),
        }
      )
      beginReview(blob)
    } catch (e) {
      // 必須修正4: WebP非対応(canvasが黙って別形式にフォールバックした場合)は、
      // サーバーの415を待たずクライアント側で分かりやすいメッセージを出す。
      setUploadError(
        isUnsupportedWebpError(e)
          ? 'この端末はWebP形式での撮影に対応していません。「写真を選択して記録する」からお試しください。'
          : '撮影に失敗しました。もう一度お試しください。'
      )
    }
  }, [reviewPhase, cameraStatus, beginReview])

  const retake = useCallback(() => {
    sessionRef.current?.retake()
    clearPreview()
    setReviewPhase('idle')
  }, [clearPreview])

  /** 1-10節: ファイル選択フォールバック。選ばれた画像もWebP化してから同じ確定フローに載せる。 */
  const captureFromFile = useCallback(async (file: File) => {
    if (reviewPhase === 'reviewing') return
    try {
      const blob = await convertImageFileToWebpBlob(file)
      beginReview(blob)
    } catch (e) {
      setUploadError(
        isUnsupportedWebpError(e)
          ? 'この端末では選択した写真をWebP形式に変換できませんでした。'
          : '選択した写真を読み込めませんでした。もう一度お試しください。'
      )
    }
  }, [reviewPhase, beginReview])

  return {
    videoRef,
    cameraStatus,
    cameraErrorKind,
    startCamera,
    stopCamera,
    retryCamera: startCamera,

    bodyPart,
    setBodyPart,
    photoType,
    setPhotoType,

    ghost,
    ghostUrl,
    ghostLoading,
    ghostOpacityLevel,
    setGhostOpacityLevel,

    reviewPhase,
    previewUrl,
    shutter,
    retake,
    captureFromFile,

    uploadError,
    justSaved,
  }
}

export type UsePhotoCaptureReturn = ReturnType<typeof usePhotoCapture>

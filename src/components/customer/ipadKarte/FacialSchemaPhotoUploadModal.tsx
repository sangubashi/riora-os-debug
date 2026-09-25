'use client'
/**
 * FacialSchemaPhotoUploadModal.tsx — 過去来店の顔シェーマ写真アップロードモーダル
 * (2026-09-25ユーザー承認)。
 *
 * DocumentSlotCaptureModal.tsx / InitialQuestionnaireCaptureModal.tsxと同じ設計
 * (ゴースト・顔検出ガイド等は持たない単純な撮影/選択→レビュー→保存のみ)を、
 * 過去の来店(visitId)向けにパラメータ化して再利用する。
 * 保存先は PUT /api/customers/[id]/facial-schemas/photo。既存の顔シェーマ描画機能
 * (FacialSchemaSection.tsx・strokes_data)には一切関わらない独立機能。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, RotateCcw, Check, X } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { captureVideoFrameToBlob } from '@/lib/photos/captureFrame'
import { convertImageFileToWebpBlob } from '@/lib/photos/fileToWebpBlob'
import { classifyCameraError, type CameraErrorKind } from '@/lib/photos/cameraError'
import type { FacialSchemaApiShape } from '@/lib/facialSchema/facialSchemaApiMapping'

type Phase = 'camera' | 'reviewing' | 'saving'

interface Props {
  customerId: string
  visitId:    string
  visitLabel: string
  onClose:    () => void
  /** 保存成功時に呼ぶ(親側で一覧への反映を行う想定)。モーダルはこの中で閉じる。 */
  onSaved:    (schema: FacialSchemaApiShape) => void
}

export default function FacialSchemaPhotoUploadModal({ customerId, visitId, visitLabel, onClose, onSaved }: Props) {
  const videoRef       = useRef<HTMLVideoElement | null>(null)
  const streamRef       = useRef<MediaStream | null>(null)
  const previewUrlRef    = useRef<string | null>(null)
  const fileInputRef     = useRef<HTMLInputElement | null>(null)

  const [phase, setPhase]                 = useState<Phase>('camera')
  const [cameraReady, setCameraReady]     = useState(false)
  const [cameraErrorKind, setCameraErrorKind] = useState<CameraErrorKind | null>(null)
  const [previewUrl, setPreviewUrl]       = useState<string | null>(null)
  const [pendingBlob, setPendingBlob]     = useState<Blob | null>(null)
  const [saveError, setSaveError]         = useState<string | null>(null)

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setCameraErrorKind(null)
    const available = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    if (!available) {
      setCameraErrorKind(classifyCameraError(null, false))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraReady(true)
    } catch (err) {
      releaseStream()
      setCameraErrorKind(classifyCameraError(err, true))
    }
  }, [releaseStream])

  useEffect(() => {
    void startCamera()
    return () => {
      releaseStream()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const beginReview = useCallback((blob: Blob) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = URL.createObjectURL(blob)
    previewUrlRef.current = url
    setPreviewUrl(url)
    setPendingBlob(blob)
    setSaveError(null)
    setPhase('reviewing')
  }, [])

  const shutter = useCallback(async () => {
    const video = videoRef.current
    if (!video || !cameraReady) return
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
    } catch {
      setSaveError('撮影に失敗しました。もう一度お試しください。')
    }
  }, [cameraReady, beginReview])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const blob = await convertImageFileToWebpBlob(file)
      beginReview(blob)
    } catch {
      setSaveError('選択した画像を読み込めませんでした。もう一度お試しください。')
    }
  }

  const retake = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
    setPendingBlob(null)
    setSaveError(null)
    setPhase('camera')
  }

  const handleSave = async () => {
    if (!pendingBlob) return
    setPhase('saving')
    setSaveError(null)
    try {
      const form = new FormData()
      form.set('visitId', visitId)
      form.set('file', pendingBlob, `facial-schema.${pendingBlob.type === 'image/jpeg' ? 'jpg' : 'webp'}`)
      const res = await authedFetch(`/api/customers/${customerId}/facial-schemas/photo`, {
        method: 'PUT',
        body:   form,
      })
      if (!res.ok) throw new Error('upload_failed')
      const json = await res.json() as { success: boolean; schema?: FacialSchemaApiShape }
      if (!json.success || !json.schema) throw new Error('upload_failed')
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      onSaved(json.schema)
    } catch {
      setSaveError('保存に失敗しました。もう一度お試しください。')
      setPhase('reviewing')
    }
  }

  const handleClose = () => {
    releaseStream()
    onClose()
  }

  const buttonStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '14px 22px', borderRadius: '999px', border: 'none', cursor: 'pointer',
    fontSize: '14px', fontWeight: 700, fontFamily: headingFont.style.fontFamily,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'max(14px, calc(env(safe-area-inset-top) + 10px)) 20px 12px', borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
          {visitLabel}の顔シェーマ写真を登録
        </p>
        <button
          type="button"
          onClick={handleClose}
          aria-label="閉じる"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: PALETTE.muted }}
        >
          <X size={22} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '18px', overflow: 'hidden' }}>
        {phase === 'camera' ? (
          <>
            <div style={{ position: 'relative', width: '100%', maxWidth: '520px', aspectRatio: '3 / 4', background: '#000', borderRadius: '14px', overflow: 'hidden' }}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraReady ? 'block' : 'none' }} />
              {!cameraReady && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                  {cameraErrorKind ? 'カメラを起動できませんでした。下の「ファイルから選択」をお使いください。' : 'カメラを起動しています…'}
                </div>
              )}
            </div>

            {saveError && <p style={{ margin: 0, fontSize: '13px', color: '#DC2626' }}>{saveError}</p>}

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" onClick={shutter} disabled={!cameraReady} style={{ ...buttonStyle, background: PALETTE.gold, color: '#fff', opacity: cameraReady ? 1 : 0.5 }}>
                <Camera size={18} /> 撮影する
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...buttonStyle, background: 'none', border: `1.5px solid ${PALETTE.border}`, color: PALETTE.text }}>
                <ImagePlus size={18} /> ファイルから選択(サロンボードのスクショ等)
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ width: '100%', maxWidth: '520px', aspectRatio: '3 / 4', borderRadius: '14px', overflow: 'hidden', border: `1px solid ${PALETTE.border}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ローカルobject URLのプレビューのためnext/imageは不要 */}
              {previewUrl && <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />}
            </div>

            {saveError && <p style={{ margin: 0, fontSize: '13px', color: '#DC2626' }}>{saveError}</p>}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button type="button" onClick={retake} disabled={phase === 'saving'} style={{ ...buttonStyle, background: 'none', border: `1.5px solid ${PALETTE.border}`, color: PALETTE.text }}>
                <RotateCcw size={18} /> 撮り直す
              </button>
              <button type="button" onClick={() => void handleSave()} disabled={phase === 'saving'} style={{ ...buttonStyle, background: PALETTE.gold, color: '#fff', opacity: phase === 'saving' ? 0.6 : 1 }}>
                <Check size={18} /> {phase === 'saving' ? '保存中…' : '保存する'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

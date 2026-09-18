'use client'
/**
 * useFaceGuide.ts — 撮影ガイド強化(PHASE IPAD-PHOTO-CAPTURE-3・2026-09-15)向けの
 * MediaPipe(@mediapipe/tasks-vision)バインディング。
 *
 * 判定ロジック本体はsrc/lib/photos/faceGuide.tsの純粋関数に委譲する(usePhotoCapture.ts・
 * useVoiceMemoFlow.tsと同じ設計思想)。このフックはFaceDetectorのロード・映像フレームへの
 * 定期的な推論・結果のReact state化のみを担う。
 *
 * WASMランタイム・モデルファイルは自前ホスティング(public/mediapipe/以下)を使う
 * (Google CDNへの実行時依存を避けるため)。FaceDetectorのロードはモジュールレベルで
 * 1回だけ行い、モーダルの開閉のたびに再ダウンロード・再初期化しない(11MB超のWASMの
 * 再取得を避けるため。ブラウザキャッシュされていても初期化コスト自体は毎回発生するため)。
 */
import { useEffect, useRef, useState } from 'react'
import { evaluateFaceGuide, type FaceGuideDetection, type FaceGuideMode, type FaceGuideState } from '@/lib/photos/faceGuide'

const WASM_BASE_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/blaze_face_short_range.tflite'

/** 推論間隔(ms)。実機での負荷・精度を見て調整するPhase1暫定値。 */
export const FACE_GUIDE_DETECTION_INTERVAL_MS = 250

type FaceDetectorInstance = import('@mediapipe/tasks-vision').FaceDetector

let detectorPromise: Promise<FaceDetectorInstance> | null = null

/** FaceDetectorの初期化(WASM+モデルロード)。アプリ内で1回だけ実行し、以降は使い回す。 */
function loadFaceDetector(): Promise<FaceDetectorInstance> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'VIDEO',
      })
    })().catch(err => {
      // 失敗した場合は次回呼び出しで再試行できるようにキャッシュをクリアする
      detectorPromise = null
      throw err
    })
  }
  return detectorPromise
}

export interface UseFaceGuideOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  mode: FaceGuideMode
  /** カメラが実際に映像を流している間のみtrueにする(idle/requesting/error中は推論しない)。 */
  active: boolean
}

export interface UseFaceGuideResult {
  state: FaceGuideState | null
  /** モデルの初回ロード中(WASM+モデル取得)。 */
  modelLoading: boolean
  modelError: string | null
}

/**
 * detectionのkeypoints(6点、右目=0・左目=1、docs参照)からfaceGuide.ts向けの
 * eyes形式へ変換する。キーポイントが無い/不足している場合はundefinedを返す
 * (傾き判定はnot_checkedにフォールバックする、faceGuide.ts側の既定動作)。
 */
function extractEyes(
  keypoints: { x: number; y: number }[] | undefined
): FaceGuideDetection['eyes'] {
  if (!keypoints || keypoints.length < 2) return undefined
  return { rightEye: keypoints[0], leftEye: keypoints[1] }
}

export function useFaceGuide({ videoRef, mode, active }: UseFaceGuideOptions): UseFaceGuideResult {
  const [state, setState] = useState<FaceGuideState | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const detectorRef = useRef<FaceDetectorInstance | null>(null)

  // modeが'none'(額)の場合はそもそもモデルをロードしない(検出不要と判断済みのため)。
  useEffect(() => {
    if (mode === 'none' || !active) return

    let cancelled = false
    setModelLoading(true)
    setModelError(null)

    loadFaceDetector()
      .then(detector => {
        if (cancelled) return
        detectorRef.current = detector
        setModelLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setModelError(err instanceof Error ? err.message : 'face_detector_load_failed')
        setModelLoading(false)
      })

    return () => { cancelled = true }
  }, [mode, active])

  useEffect(() => {
    if (mode === 'none' || !active) {
      setState(null)
      return
    }

    const intervalId = window.setInterval(() => {
      const detector = detectorRef.current
      const video = videoRef.current
      if (!detector || !video || video.readyState < 2 || video.videoWidth === 0) return

      try {
        const result = detector.detectForVideo(video, performance.now())
        const detection = result.detections[0]
        const faceGuideDetection: FaceGuideDetection | null = detection?.boundingBox
          ? {
              box: {
                x: detection.boundingBox.originX,
                y: detection.boundingBox.originY,
                width: detection.boundingBox.width,
                height: detection.boundingBox.height,
              },
              eyes: extractEyes(detection.keypoints),
            }
          : null

        setState(evaluateFaceGuide(faceGuideDetection, mode, {
          width: video.videoWidth,
          height: video.videoHeight,
        }))
      } catch {
        // 1フレームの推論失敗で撮影全体を止めない(次の間隔で再試行される)。
      }
    }, FACE_GUIDE_DETECTION_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [mode, active, videoRef])

  return { state, modelLoading, modelError }
}

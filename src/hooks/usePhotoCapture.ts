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
import {
  captureVideoFrameToBlob,
  captureVideoFrameToBlobAt,
  waitBeforeShutterCapture,
  MAX_THUMBNAIL_LONG_EDGE_PX,
  THUMBNAIL_ENCODE_QUALITY,
} from '@/lib/photos/captureFrame'
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
import { convertImageFileToWebpBlobWithThumbnail } from '@/lib/photos/fileToWebpBlob'

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error'
export type GhostOpacityLevel = 'off' | 'weak' | 'strong'

/**
 * focusMode/exposureMode(連続AF/AE)はImage Capture API拡張のプロパティで、
 * TypeScript同梱のlib.dom.d.ts(MediaTrackConstraintSet)には定義されていない
 * (このプロジェクトのTS 5.9.3で確認済み)。手ブレ・ピンボケ対策(2026-09-28
 * ユーザー承認)としてideal指定のみ追加するが、**iPadOS Safari(このアプリの対象
 * 環境)は現時点(2026年1月時点の知識)でこの制約自体をサポートしていない**
 * (iOSのカメラはgetUserMediaのプレビュー用ストリームに対し、そもそもWeb側から
 * 制御する手段のない常時連続AF/AEをハードウェア層で行っている)。ideal指定は
 * 非対応環境では単に無視されるだけで例外にはならない(exact/min/maxと違い
 * OverconstrainedErrorを起こさない)ため、実害のない前提で追加している
 * (Chromium系ブラウザでの対応・将来のSafari対応時に備えるだけの意味合いが強く、
 * 実機(iPad)での見た目上の改善効果は無いと考えるべき)。
 */
interface ExtendedVideoConstraints extends MediaTrackConstraintSet {
  focusMode?:    ConstrainDOMString
  exposureMode?: ConstrainDOMString
}

/**
 * 写真撮影画質改善 Phase 3-A: カメラ起動時のconstraints。
 * width/height/facingModeいずれも「ideal」でのみ要求し、exactにはしない
 * (端末が3072x2304や背面カメラに対応していなくても撮影自体はできるようにするため。
 * classifyCameraError.tsのOverconstrainedError分類は変えずに済む)。
 * ideal指定は「できればこの解像度が欲しい」という要求であり、端末が対応していなければ
 * ブラウザが実際に返せる値へ自動的に妥協する(無理なアップスケールはしない)。
 * 保存時リサイズ(captureFrame.ts、長辺3072px)・エンコード品質(0.9)と揃えた値。
 *
 * 手ブレ・モーションブラー対策(2026-09-28ユーザー承認): frameRate ideal 30を追加
 * (フレームレートが低いほど自動露出が長いシャッター速度を選びやすくなるため、
 * 「できれば30fps」という緩い上限のヒントを与える)。focusMode/exposureModeは
 * 上記の通りideal限定・iPadOS Safariでは実効性が無い前提で追加。実際に効くのは
 * 主にshutter()側のタイミング制御(waitBeforeShutterCapture)。
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode:   { ideal: 'environment' },
    width:        { ideal: 3072 },
    height:       { ideal: 2304 },
    frameRate:    { ideal: 30 },
    focusMode:    { ideal: 'continuous' },
    exposureMode: { ideal: 'continuous' },
  } as ExtendedVideoConstraints,
  audio: false,
}

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
  /**
   * 店舗共通ログイン+担当者タグ選択(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)用の
   * 任意の担当者(brain_staff.id)上書き。個人ログイン時は常にnull/未指定。
   */
  staffId?:        string | null
}

function isGhostOpacityLevel(v: string | null): v is GhostOpacityLevel {
  return v === 'off' || v === 'weak' || v === 'strong'
}

export function usePhotoCapture(options: UsePhotoCaptureOptions) {
  const { customerId, visitId, staffId = null } = options

  const videoRef       = useRef<HTMLVideoElement | null>(null)
  const streamRef       = useRef<MediaStream | null>(null)
  const sessionRef       = useRef<CaptureConfirmSession | null>(null)
  const previewUrlRef    = useRef<string | null>(null)

  const [cameraStatus, setCameraStatus]       = useState<CameraStatus>('idle')
  const [cameraErrorKind, setCameraErrorKind] = useState<CameraErrorKind | null>(null)

  const [bodyPart, setBodyPart]   = useState(options.initialBodyPart)
  const [photoType, setPhotoType] = useState<CapturePhotoType>('before')
  // 撮影日の明示指定(過去写真登録・2026-09-17設計調査で確定): 未指定(null)の間は
  // 既存どおりCapturedPhotoPayload.takenAtを省略し、サーバー側now()フォールバックに
  // 委ねる(既存動作を維持)。呼び出し側(UI)が過去日付を選んだ場合のみ、その値を
  // beginReview()経由でcapture()へ渡す。API・DB側は元々このフィールドを受理する
  // 設計になっており(captureConfirmFlow.ts・photoApiClient.ts・route.ts参照)、
  // ここでは値を通すだけで新規のI/Oは発生しない。
  const [takenAtOverride, setTakenAtOverride] = useState<string | null>(null)

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

  // 手ブレ/モーションブラー対策の実機診断用(2026-09-28ユーザー承認・元は調査用の
  // 一時コードを整理して確定): 実機で実際に割り当てられたカメラ解像度/FPS・
  // focusMode/exposureMode等がtrack.getSettings()/getCapabilities()でどう見えるかを
  // console.logのみで観測する(constraint自体・撮影動作には一切影響しない)。
  // カメラ起動直後(camera_ready)とシャッター直前(before_shutter)の2箇所でのみ呼ぶ
  // (以前あった起動3秒後の追加チェックは、この2点があれば十分なため削除した)。
  const logCameraDiagnostics = useCallback((label: string) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    console.log('[PHOTO_KARTE][camera-diag]', label, 'settings=', track.getSettings())
    if (typeof track.getCapabilities === 'function') {
      console.log('[PHOTO_KARTE][camera-diag]', label, 'capabilities=', track.getCapabilities())
    }
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
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraStatus('ready')
      logCameraDiagnostics('camera_ready')
    } catch (err) {
      releaseStream()
      setCameraStatus('error')
      setCameraErrorKind(classifyCameraError(err, true))
    }
  }, [releaseStream, logCameraDiagnostics])

  const stopCamera = useCallback(() => {
    releaseStream()
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraStatus('idle')
  }, [releaseStream])

  // バックグラウンド時のカメラ解放(2026-09-28ユーザー承認): タブ切替・他アプリへの
  // 切替・画面ロック等でこのページが非表示になっている間、カメラを起動したままにしておく
  // 理由がないため停止し、メモリ・GPU・カメラハードウェアを解放する。連続撮影中の
  // レビュー画面(reviewPhase==='reviewing')ではカメラを維持する既存方針(ユーザー承認済み、
  // 連続撮影の応答性を優先)とは別軸の対策で、こちらは「実際に画面を見ていない」ケースに
  // 限定される。フォアグラウンド復帰時は、この処理で自分が停止した場合のみ再取得する
  // (元からidle/errorだった場合は何もしない)。
  const stoppedByVisibilityRef = useRef(false)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (cameraStatus === 'ready') {
          stoppedByVisibilityRef.current = true
          stopCamera()
        }
      } else if (stoppedByVisibilityRef.current) {
        stoppedByVisibilityRef.current = false
        void startCamera()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [cameraStatus, stopCamera, startCamera])

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

  // 連続撮影で画面が真っ黒になる不具合の修正(2026-09-17調査・原因確定):
  // IpadPhotoCaptureModal.tsx側は「reviewPhase==='reviewing'の間だけ<video>を描画し、
  // それ以外はvideoを含む別のJSXツリーを描画する」構造になっており、レビュー画面から
  // カメラ映像へ戻るたびにReactが<video>を新しいDOM要素として再マウントする
  // (実機なしでPlaywright+フェイクカメラで実測済み: シャッター前はsrcObjectあり・
  // videoWidth>0だったのに、「撮り直す」後は別のDOM要素・srcObject=null・videoWidth=0に
  // なることを確認)。startCamera()はモーダル最初の1回しか呼ばれずsrcObjectを設定しないため、
  // 新しいvideo要素は誰にもストリームを割り当てられないまま真っ黒になる。
  //
  // Reactはコミット時にrefを同期的に更新するため、この副作用が実行される時点で
  // videoRef.currentは(新しいDOM要素に置き換わっていたとしても)既に最新の要素を
  // 指している。ref自体の変更を検知する仕組みは不要で、reviewPhase/cameraStatusという
  // 「videoの描画有無に直結するstate」の変化を検知するだけで十分。
  //
  // 既存ストリーム(streamRef.current)は停止・再取得せず、新しいvideo要素への再アタッチ
  // (srcObject再設定+play()再実行)のみを行う。play()が失敗した場合は既存の
  // startCamera()と同じ分類・状態管理(classifyCameraError→cameraStatus='error')に
  // 委ね、「もう一度試す」ボタン(retryCamera=startCamera)による正規の再取得で復旧させる
  // (この副作用自身はreleaseStreamを呼ばない。既存ストリームの停止はstartCamera側の
  // 責務のまま変更しない)。
  useEffect(() => {
    if (reviewPhase === 'reviewing') return
    if (cameraStatus !== 'ready') return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream || video.srcObject) return

    video.srcObject = stream
    video.play().catch(err => {
      setCameraStatus('error')
      setCameraErrorKind(classifyCameraError(err, true))
    })
  }, [reviewPhase, cameraStatus])

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

  /**
   * WebP・JPEGいずれのエンコードにも失敗した(=encodeCanvasWithFallbackが両方とも
   * 失敗した)場合のエラーかどうかを判定する。JPEGは全ブラウザでネイティブ対応の
   * ため、通常この経路にはほぼ到達しない(WebP実機テスト時のiPhone 11の問題は
   * JPEGフォールバックで解消済み)。
   */
  const isUnsupportedImageEncodingError = (e: unknown): boolean =>
    e instanceof Error && e.message.startsWith('unsupported_image_encoding')

  const beginReview = useCallback((blob: Blob, thumbnailBlob?: Blob | null) => {
    clearPreview()
    const url = URL.createObjectURL(blob)
    previewUrlRef.current = url
    setPreviewUrl(url)
    setUploadError(null)
    setJustSaved(false)
    setReviewPhase('reviewing')

    ensureSession().capture({ blob, thumbnailBlob, bodyPart, photoType, visitId, takenAt: takenAtOverride ?? undefined, staffId })
  }, [bodyPart, photoType, visitId, takenAtOverride, staffId, ensureSession, clearPreview])

  // 手ブレ対策(2026-09-28ユーザー承認): shutter()呼び出しからbeginReview()による
  // reviewPhase='reviewing'までの間(=下記のwaitBeforeShutterCapture待機中)は
  // reviewPhaseがまだ'idle'のままのため、既存の「reviewPhase==='reviewing'なら
  // 何もしない」ガードだけでは連続タップによる二重撮影を防げない。この待機窓を
  // 塞ぐための同期フラグ。
  const capturingRef = useRef(false)

  const shutter = useCallback(async () => {
    if (reviewPhase === 'reviewing') return // 二重シャッター防止
    if (capturingRef.current) return // 手ブレ対策の待機中の二重タップ防止
    if (!videoRef.current || cameraStatus !== 'ready') return

    logCameraDiagnostics('before_shutter')
    capturingRef.current = true
    const video = videoRef.current

    try {
      // 手ブレ・モーションブラー対策(2026-09-28ユーザー承認): タップ操作自体が伝える
      // 微振動が収まるのを固定ディレイで待ち、対応環境(iPadOS Safari 15.4+含む)では
      // requestVideoFrameCallbackで実際に新しいフレームが描画されたことを確認した上で
      // videoWidth/videoHeightを読み、canvasへ描画する(即時同期取得だと、タップ直後の
      // 遷移中フレームを掴む可能性を減らせないため)。
      await waitBeforeShutterCapture({
        wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        waitForNextFrame: () => new Promise(resolve => {
          if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback(() => resolve())
          } else {
            resolve()
          }
        }),
      })

      const source = { element: video, width: video.videoWidth, height: video.videoHeight }
      const deps = {
        createCanvas: () => document.createElement('canvas'),
        canvasToBlob: (canvas: unknown, mimeType: string, quality?: number) =>
          new Promise<Blob>((resolve, reject) => {
            (canvas as unknown as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error('canvas_to_blob_failed'))),
              mimeType,
              quality
            )
          }),
      }
      const blob = await captureVideoFrameToBlob(source, deps)

      // 写真サムネイル機能③(2026-09-26ユーザー承認): 同じvideoソースから追加で
      // 軽量サムネイルを生成する。原本(blob)の確定には一切影響させない
      // (失敗してもログのみでcatchし、thumbnailBlob=undefinedのまま続行する)。
      let thumbnailBlob: Blob | undefined
      try {
        thumbnailBlob = await captureVideoFrameToBlobAt(
          source, deps, MAX_THUMBNAIL_LONG_EDGE_PX, THUMBNAIL_ENCODE_QUALITY
        )
      } catch (e) {
        console.error('[PHOTO_KARTE][thumbnail] カメラ撮影経路のサムネイル生成に失敗(非致命的、原本のみで続行):', e)
      }

      beginReview(blob, thumbnailBlob)
    } catch (e) {
      // 必須修正4(改訂): WebP→JPEGの順にフォールバックしても両方失敗した
      // (通常ほぼ起こらない)場合のみ、クライアント側で分かりやすいメッセージを出す。
      setUploadError(
        isUnsupportedImageEncodingError(e)
          ? 'この端末では撮影画像を保存可能な形式に変換できませんでした。「写真を選択して記録する」からお試しください。'
          : '撮影に失敗しました。もう一度お試しください。'
      )
    } finally {
      capturingRef.current = false
    }
  }, [reviewPhase, cameraStatus, beginReview, logCameraDiagnostics])

  const retake = useCallback(() => {
    sessionRef.current?.retake()
    clearPreview()
    setReviewPhase('idle')
  }, [clearPreview])

  /** 1-10節: ファイル選択フォールバック。選ばれた画像もWebP化してから同じ確定フローに載せる。 */
  const captureFromFile = useCallback(async (file: File) => {
    if (reviewPhase === 'reviewing') return
    try {
      // 写真サムネイル機能③(2026-09-26ユーザー承認): 同じデコード済み画像から
      // 原本(full、従来と全く同じ仕様)とサムネイル(thumbnail、生成失敗時はnull)を
      // 1回のデコードでまとめて生成する(fileToWebpBlob.ts側で二重デコードを回避)。
      const { full, thumbnail } = await convertImageFileToWebpBlobWithThumbnail(file)
      beginReview(full, thumbnail)
    } catch (e) {
      setUploadError(
        isUnsupportedImageEncodingError(e)
          ? 'この端末では選択した写真を保存可能な形式に変換できませんでした。'
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
    takenAtOverride,
    setTakenAtOverride,

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

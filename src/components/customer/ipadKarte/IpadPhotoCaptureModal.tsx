'use client'
/**
 * IpadPhotoCaptureModal.tsx — iPadスタッフカルテ「写真カルテ」セクションの
 * 「撮影する」「選択して追加」モーダル(PHASE IPAD-PHOTO-CAPTURE-1・2026-09-15緊急実装)。
 *
 * 背景: 撮影機能のiPad一本化方針(commit 46c6900)に伴いスマホ側の撮影導線を削除したが、
 * iPad側の撮影導線が未実装のまま残っていた(旧スマホ実装のPhotoCaptureView.tsx等は
 * 同commitで削除済み・復元しない・方針B確定)。ロジック本体(usePhotoCapture.ts以下、
 * 写真カルテ原本保存化Phase Aの土台)は無傷で残っていたためそのまま流用し、
 * UIのみを新規に組む。
 *
 * 既存のPhotoPanel(表示・比較用、PhotoCompareKit.tsx)には一切手を加えず、独立した
 * 撮影・追加フローとして実装する。
 *
 * 部位(正面/右斜め/左斜め/額)の選択必須化: usePhotoCaptureへは initialBodyPart='' で渡し、
 * IPAD_KARTE_ANGLESのいずれかを明示的に選ぶまでシャッター/ファイル選択ボタンを
 * 無効化する(枚数によらず、部位未選択のまま登録できないことを構造的に保証する)。
 *
 * photoTypeは常に'progress'固定(ユーザー確定・2026-09-15): iPadスタッフカルテの
 * 「前回|今回」比較は施術前後の区別を表示に使わないため、before/after選択UIは設けない。
 *
 * 撮影ガイド強化(PHASE IPAD-PHOTO-CAPTURE-3・2026-09-15): useFaceGuide.ts
 * (@mediapipe/tasks-vision)による大きさ・位置・(正面のみ)傾きのリアルタイムフィードバック。
 * 詳細はfaceGuideModeFor()・src/lib/photos/faceGuide.tsのコメント参照。実機での閾値
 * チューニング前のPhase1実装であることに留意。
 *
 * 写真カルテ Phase 2(2026-09-17、IMG_1448.JPGのデザイン確定): 全画面レイアウトへ変更し、
 * 以下を追加した。既存の撮影・保存ロジック(usePhotoCapture.ts・captureConfirmFlow.ts・
 * faceGuide.ts・useFaceGuide.ts)には一切手を加えていない。
 *   - ゴースト機能(useGhostOverlay.ts): ON/OFF・強さ(連続%)・前回日付の手動切替。
 *     自動選択自体はusePhotoCapture.tsの既存ロジック(ghost/ghostUrl)をそのまま使う。
 *   - 水平器/ジャイロガイド(useDeviceTilt.ts・tiltGuide.ts): 額タブ(顔検出なし)でも
 *     機能する、端末の傾き検知。iOS13+は初回のみ明示的なタップでの権限許可が必要。
 *   - ズーム倍率表示(「1x」バッジ): getUserMediaのzoom制約はiPadOS Safariでは
 *     機能しないため実際の倍率ロックではなく表示のみ。アプリのviewport設定
 *     (app/layout.tsx、userScalable:false)により、ページ自体のピンチズームは
 *     元々無効化済み。
 *   - 自動保存の視覚フィードバック(savedFlash)・ガイドメッセージの視認性向上は
 *     Phase 2と合わせて実装(2026-09-17ユーザー承認)。
 *
 * ゴーストの初期位置・サイズ合わせ(実機フィードバックを受けての再設計、2026-09-18
 * ユーザー承認): 当初は「ライブ映像の顔検出結果にゴーストを継続追従させる」方式
 * (translate/scaleを250ms間隔で常に再計算)を実装したが、実機で検出結果のフレーム
 * ごとのブレがそのままゴーストの微振動として見えてしまい(「ゴーストが下でちょこちょこ
 * 動いてるだけ」)、使い物にならないと判明した。
 *
 * 調査の結果、既存の顔検出ガイド(下の丸い破線の輪、faceGuideMode!=='none'の時に表示)
 * は検出結果に応じて動かない固定形状(CSSの固定パーセンテージ)であることを確認した。
 * この輪は「顔をここに収めてください」という不変のターゲットであり、ライブ映像は
 * 既存のuseFaceGuide.ts/faceGuide.tsのフィードバックで既にこの枠に収まるよう案内
 * されている。そこで、ゴースト(前回写真)の顔もこの同じ固定ターゲットに一度だけ
 * 合わせる方式(src/lib/photos/ghostAlignment.ts の computeGhostRingAlignment、
 * ターゲットの数値はfaceGuide.tsのFACE_GUIDE_SIZE_MIN_RATIO〜MAX_RATIOの中央値・
 * 画面中央0.5,0.5)へ置き換えた。ゴースト静止画は動かないため、この計算は写真が
 * 切り替わった時と表示枠のリサイズ時にだけ行えばよく、ライブ映像の検出ループには
 * 一切依存しない(ジッターの原因を構造的に排除する)。ライブ側の顔を輪に収める案内は
 * 既存のuseFaceGuide.ts/faceGuide.tsがそのまま担い、この変更では一切手を加えていない。
 * 既存の手動「サイズ」スライダーは、この自動合わせの結果に対する追加の微調整倍率として
 * 残している(既定100%=無補正)。既存の撮影・保存ロジック(usePhotoCapture.ts・
 * captureConfirmFlow.ts・faceGuide.ts・useFaceGuide.ts・ghostSelection.ts・API・DB)
 * には一切手を加えていない。保存される写真は従来通り<video>フレームのみから生成され
 * (captureFrame.ts)、ゴースト(<img>)への参照を一切持たないため、この変更後も
 * 「保存画像にゴーストが焼き込まれない」構造的保証は変わらない。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Calendar, Camera, CheckCircle2, Crosshair, ImagePlus, Lock, RotateCcw, X,
} from 'lucide-react'
import { usePhotoCapture } from '@/hooks/usePhotoCapture'
import { useFaceGuide } from '@/hooks/useFaceGuide'
import { useDeviceTilt } from '@/hooks/useDeviceTilt'
import {
  useGhostOverlay, formatGhostDateLabel, GHOST_SCALE_MIN_PERCENT, GHOST_SCALE_MAX_PERCENT,
} from '@/hooks/useGhostOverlay'
import { useGhostImageFaceDetection } from '@/hooks/useGhostImageFaceDetection'
import { pickFaceGuideMessage, type FaceGuideMode } from '@/lib/photos/faceGuide'
import { computeGhostRingAlignment } from '@/lib/photos/ghostAlignment'
import { pickTiltMessage } from '@/lib/photos/tiltGuide'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { IPAD_KARTE_ANGLES, type IpadKarteAngleId } from './ipadKarteData'

/**
 * 撮影ガイド強化(PHASE IPAD-PHOTO-CAPTURE-3・2026-09-15、久保田さん確認済みの設計)。
 * 正面: 大きさ・位置・傾きの3種フィードバック。右斜め・左斜め: 大きさ・位置のみ
 * (傾きの基準が未確定のため今回は見送り)。額: 顔検出自体を行わず静的な枠ガイド＋
 * ジャイロのみで運用する(額クローズアップは目・鼻・口が写らずモデルが顔として
 * 認識できない可能性が高いため)。
 */
function faceGuideModeFor(bodyPart: string): FaceGuideMode {
  if (bodyPart === 'face_front') return 'full'
  if (bodyPart === 'face_right' || bodyPart === 'face_left') return 'position_size'
  return 'none'
}

/**
 * 自動保存フィードバック(2026-09-17)。1.5秒の自動確定タイマーが完了した瞬間
 * (reviewPhaseが'reviewing'→'confirmed'に変わる瞬間。ネットワーク応答=justSavedを
 * 待たないローカルな確定タイミング)にだけ出すチェックマーク演出の表示時間。Phase1暫定値。
 */
const SAVED_FLASH_DURATION_MS = 900

/**
 * 撮影日入力(<input type="date">)のmax属性用に、今日の日付を"YYYY-MM-DD"
 * (ローカルタイムゾーン基準)で返す。未来日を撮影日として指定できないようにする。
 */
function todayDateInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type PhotoCaptureIntent = 'camera' | 'picker'

interface Props {
  customerId: string
  visitId: string | null
  intent: PhotoCaptureIntent
  onClose: () => void
  /** 1枚保存成功のたびに呼ぶ(親側でIpadKarteDataのrefetchPhotosを呼ぶ想定)。モーダルは閉じない。 */
  onSaved: () => void
}

function isValidBodyPart(v: string): v is IpadKarteAngleId {
  return IPAD_KARTE_ANGLES.some(a => a.id === v)
}

/** ゴースト日付リストの1行分のスタイル(選択中は強調)。 */
function dateOptionStyle(selected: boolean): React.CSSProperties {
  return {
    textAlign: 'left', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
    fontSize: '12px', border: 'none',
    background: selected ? PALETTE.gold : 'transparent',
    color: selected ? '#fff' : PALETTE.text,
  }
}

/** シンプルなON/OFFトグルスイッチ(緑=ON、既存のlucideアイコンセットに依存しない自前実装)。 */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: '44px', height: '26px', borderRadius: '999px', border: 'none', cursor: 'pointer',
        background: checked ? '#22C55E' : PALETTE.border, position: 'relative', flexShrink: 0,
        transition: 'background 0.15s ease',
      }}
    >
      <span
        style={{
          position: 'absolute', top: '3px', left: checked ? '21px' : '3px',
          width: '20px', height: '20px', borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

export default function IpadPhotoCaptureModal({ customerId, visitId, intent, onClose, onSaved }: Props) {
  const capture = usePhotoCapture({ customerId, visitId, initialBodyPart: '' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pickerBusy, setPickerBusy] = useState(false)
  // 撮影日の明示指定(過去写真登録)。"YYYY-MM-DD"のUI表示用state。空文字=未指定
  // (既存どおりアップロード時刻を撮影日時として使う)。usePhotoCapture.tsの
  // takenAtOverrideへは"T12:00:00.000Z"(UTC正午)を付けて渡す(日付のみ指定時、
  // タイムゾーンに関わらず指定した日付がそのまま保存されるようにするための安全策)。
  const [takenAtDateInput, setTakenAtDateInput] = useState('')
  const [dateListOpen, setDateListOpen] = useState(false)

  // 自動保存フィードバック(2026-09-17): reviewPhaseが'confirmed'になった瞬間
  // (=1.5秒の自動確定タイマー発火、ネットワーク応答を待たないローカルな確定)にだけ
  // 短時間のチェックマーク演出を出す。「保存に成功した」ことの表示ではなく「この場での
  // 撮影は確定し、次に進んでよい」ことを示す演出であり、サーバー保存の成否を示す
  // justSaved連動の既存テキスト(下部)とは役割を分ける。
  const [savedFlash, setSavedFlash] = useState(false)
  const savedFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (capture.reviewPhase !== 'confirmed') return
    setSavedFlash(true)
    if (savedFlashTimeoutRef.current !== null) clearTimeout(savedFlashTimeoutRef.current)
    savedFlashTimeoutRef.current = setTimeout(() => {
      setSavedFlash(false)
      savedFlashTimeoutRef.current = null
    }, SAVED_FLASH_DURATION_MS)
    return () => {
      if (savedFlashTimeoutRef.current !== null) {
        clearTimeout(savedFlashTimeoutRef.current)
        savedFlashTimeoutRef.current = null
      }
    }
  }, [capture.reviewPhase])

  // アップロードが失敗したことが分かった時点で、演出が「保存済み」であるかのように
  // 誤認させ続けないよう、表示中のチェック演出を即座に消す(失敗自体はuploadErrorの
  // 既存メッセージで別途伝える)。
  useEffect(() => {
    if (!capture.uploadError) return
    setSavedFlash(false)
    if (savedFlashTimeoutRef.current !== null) {
      clearTimeout(savedFlashTimeoutRef.current)
      savedFlashTimeoutRef.current = null
    }
  }, [capture.uploadError])

  // photoTypeは常に'progress'固定(iPadスタッフカルテの前回|今回比較用途に限定するため)。
  useEffect(() => {
    capture.setPhotoType('progress')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (intent === 'camera') void capture.startCamera()
    return () => { capture.stopCamera() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  useEffect(() => {
    if (capture.justSaved) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.justSaved])

  const bodyPartSelected = isValidBodyPart(capture.bodyPart)
  const faceGuideMode = faceGuideModeFor(capture.bodyPart)
  const faceGuideActive = intent === 'camera' && capture.cameraStatus === 'ready' && bodyPartSelected
  const faceGuide = useFaceGuide({ videoRef: capture.videoRef, mode: faceGuideMode, active: faceGuideActive })
  const faceGuideMessage = faceGuide.state ? pickFaceGuideMessage(faceGuide.state) : null

  // 水平器/ジャイロガイド(写真カルテ Phase 2)。顔検出の有無に関わらず、額タブも含めて
  // 常に有効にする(額タブは顔検出が無い分、ジャイロだけが唯一のリアルタイムガイドになる)。
  const tilt = useDeviceTilt(faceGuideActive)
  const tiltMessage = pickTiltMessage(tilt.level)

  // ゴースト機能(写真カルテ Phase 2)。自動選択自体はusePhotoCapture.ts側の既存ロジック
  // (ghost/ghostUrl)をそのまま使い、ON/OFF・強さ・日付の手動切替のみをこのフックで足す。
  const ghost = useGhostOverlay({
    customerId,
    bodyPart: capture.bodyPart,
    currentVisitId: visitId,
    autoGhost: capture.ghost,
    autoGhostUrl: capture.ghostUrl,
  })
  const ghostVisible = ghost.enabled && !!ghost.activeUrl

  // ゴーストの初期位置・サイズ合わせ(実機フィードバックを受けての再設計、2026-09-18)。
  // ゴースト静止画に対して一度だけ顔検出を行い(useGhostImageFaceDetection)、既存の
  // 顔検出ガイド(丸い輪)が前提とする固定ターゲット(faceGuide.tsのFACE_GUIDE_SIZE_
  // MIN_RATIO〜MAX_RATIOの中央値・画面中央0.5,0.5)に合わせる(ghostAlignment.tsの
  // computeGhostRingAlignment)。ライブ映像の顔検出結果には依存しない(継続追従は
  // 廃止。ジッターの原因だったため)。ライブ側の顔を同じ輪に収める案内は既存の
  // useFaceGuide.ts/faceGuide.tsがそのまま担う(この変更では手を加えていない)。
  //
  // 表示に使う枠(video/ゴースト<img>を包む相対配置コンテナ)の実測サイズが必要なため、
  // コールバックrefでResizeObserverを張る(reviewPhaseの切り替えでこのdivがアン
  // マウント/再マウントされてもその都度張り直せるよう、useEffect+useRefではなく
  // コールバックrefにしている)。
  const [videoContainerBox, setVideoContainerBox] = useState({ width: 0, height: 0 })
  const videoContainerObserverRef = useRef<ResizeObserver | null>(null)
  const setVideoContainerRef = useCallback((el: HTMLDivElement | null) => {
    videoContainerObserverRef.current?.disconnect()
    videoContainerObserverRef.current = null
    if (!el) return
    const update = () => setVideoContainerBox({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    videoContainerObserverRef.current = observer
  }, [])

  const ghostImageFaceSample = useGhostImageFaceDetection(ghostVisible ? ghost.activeUrl : null)
  const ghostAlignment = ghostVisible
    ? computeGhostRingAlignment(videoContainerBox, ghostImageFaceSample)
    : null
  // ゴースト写真から顔検出できない場合のみ、従来通り手動での目安を示す
  // (通常はライブ側の顔検出ガイド(丸い輪)が既にこの案内の役目を果たしている)。
  const ghostMessage = ghostVisible && !ghostAlignment ? '前回の写真に合わせて位置を揃えてください' : null

  // ガイドメッセージ優先順位(2026-09-17拡張): 顔ガイド(近い/遠い/位置/傾き) > 端末の
  // 傾き(ジャイロ) > ゴーストの位置合わせ案内 > 「良い構図です」。額タブは顔ガイドが
  // 無いため、ジャイロ→ゴースト→固定文言の順になる。複数の問題が同時にあっても一度に
  // 1つだけ表示し、スタッフを迷わせない(faceGuide.tsのpickFaceGuideMessageと同じ方針)。
  const guideMessageText = faceGuideMode === 'none'
    ? (tiltMessage ?? ghostMessage ?? '額を枠内に収めてください')
    : (faceGuideMessage ?? tiltMessage ?? ghostMessage ?? (faceGuide.state?.faceDetected ? '良い構図です' : null))
  const guideMessageIsSuccess =
    faceGuideMode !== 'none' && !faceGuideMessage && !tiltMessage && !ghostMessage && !!faceGuide.state?.faceDetected
  const crosshairAligned = guideMessageIsSuccess || (faceGuideMode === 'none' && !tiltMessage)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPickerBusy(true)
    try {
      await capture.captureFromFile(file)
    } finally {
      setPickerBusy(false)
    }
  }

  const handleClose = () => {
    capture.stopCamera()
    onClose()
  }

  const showGuideOverlay = intent === 'camera' && bodyPartSelected && capture.cameraStatus === 'ready'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── ヘッダー: ロゴ＋部位タブ／意図ラベル＋閉じる ── */}
      <div
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
          padding: 'max(14px, calc(env(safe-area-inset-top) + 10px)) 24px 12px', borderBottom: `1px solid ${PALETTE.border}`,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {/* ブランド表示はロゴマーク無しの「Salon Riora」テキストのみ(2026-09-17ユーザー確定デザイン)。 */}
          <p style={{ margin: 0, fontSize: '16px', color: PALETTE.gold, letterSpacing: '0.01em', fontFamily: headingFont.style.fontFamily }}>
            Salon Riora
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {IPAD_KARTE_ANGLES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => capture.setBodyPart(a.id)}
                style={{
                  padding: '7px 15px', borderRadius: '999px', cursor: 'pointer',
                  fontSize: '13px', letterSpacing: '0.04em',
                  border: `1.5px solid ${capture.bodyPart === a.id ? PALETTE.gold : PALETTE.border}`,
                  background: capture.bodyPart === a.id ? PALETTE.gold : 'transparent',
                  color: capture.bodyPart === a.id ? '#fff' : PALETTE.text,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '12px', color: PALETTE.muted }}>
            {intent === 'camera' ? '撮影する' : '選択して追加'}{!bodyPartSelected && '(部位未選択)'}
          </span>
          <button
            type="button"
            onClick={handleClose}
            aria-label="閉じる"
            style={{
              width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
              background: PALETTE.card, border: `1.5px solid ${PALETTE.gold}`, color: PALETTE.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ── レビュー中(シャッター後/ファイル選択後、自動確定を待っている間) ── */}
      {capture.reviewPhase === 'reviewing' && capture.previewUrl ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '24px' }}>
          <div style={{ width: '100%', maxWidth: '520px', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capture.previewUrl} alt="撮影プレビュー" style={{ width: '100%', display: 'block' }} />
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted, textAlign: 'center' }}>
            このまま自動的に保存されます
          </p>
          <button
            type="button"
            onClick={capture.retake}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '12px 20px', borderRadius: '10px', border: `1.5px solid ${PALETTE.border}`,
              background: 'none', color: PALETTE.text, cursor: 'pointer',
            }}
          >
            <RotateCcw size={16} strokeWidth={1.8} />
            撮り直す
          </button>
        </div>
      ) : intent === 'camera' ? (
        <>
          {/* ── 本体: カメラ映像(写真カルテUI改善 Part 1・2026-09-18ユーザー承認により
              全幅化。ゴースト調整UIは画面下部のゴーストパネルへ移動した) ── */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div ref={setVideoContainerRef} style={{ flex: 1, position: 'relative', background: '#000', minWidth: 0 }}>
              {capture.cameraStatus === 'error' ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                  <div style={{ textAlign: 'center', maxWidth: '360px' }}>
                    <p style={{ fontSize: '14px', color: '#fff', marginBottom: '14px', lineHeight: 1.6 }}>
                      {capture.cameraErrorKind === 'permission_denied'
                        ? 'カメラへのアクセスが許可されていません。iPadの設定からカメラを許可してください。'
                        : capture.cameraErrorKind === 'unsupported'
                        ? 'この端末・ブラウザはカメラ撮影に対応していません。「選択して追加」をお使いください。'
                        : 'カメラを起動できませんでした。もう一度お試しください。'}
                    </p>
                    {capture.cameraErrorKind !== 'unsupported' && (
                      <button
                        type="button"
                        onClick={() => { void capture.retryCamera() }}
                        style={{
                          padding: '8px 16px', borderRadius: '8px', border: `1px solid ${PALETTE.gold}`,
                          background: 'none', color: '#fff', cursor: 'pointer',
                        }}
                      >
                        もう一度試す
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <video
                    ref={capture.videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />

                  {/* ゴースト(前回写真の半透明重ね表示、写真カルテ Phase 2)。「サイズ」
                      スライダー(ghost.scalePercent)は、自動位置・サイズ合わせ
                      (ghostAlignment)が算出した倍率に対する追加の微調整として掛け合わせる
                      (既定100%=無補正)。自動合わせが効かない(顔検出できない)場合は
                      従来通り等倍・中央表示+手動スライダーのみにフォールバックする
                      (マスクも自動合わせが効いている時だけ適用し、フォールバック時は
                      顔位置が分からないため画像全体をそのまま重ねる)。
                      マスク(mask-image、実機フィードバック「ゴーストが四角く切り取られ、
                      境界が目立つ」対応): 楕円のradial-gradientで顔まわりだけを自然に
                      フェード表示する(ghostAlignment.ts参照、既存の丸い顔検出ガイドと
                      同じ楕円の見た目で揃えている)。iOS Safariはベンダープレフィックス
                      (-webkit-mask-image)が必須のため両方指定する。 */}
                  {ghostVisible && ghost.activeUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ghost.activeUrl}
                      alt=""
                      style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                        opacity: ghost.opacityPercent / 100, pointerEvents: 'none',
                        transform: ghostAlignment
                          ? `translate(${ghostAlignment.translateX}px, ${ghostAlignment.translateY}px) scale(${ghostAlignment.scale * (ghost.scalePercent / 100)})`
                          : `scale(${ghost.scalePercent / 100})`,
                        transformOrigin: ghostAlignment ? `${ghostAlignment.originX}px ${ghostAlignment.originY}px` : 'center',
                        ...(ghostAlignment
                          ? {
                              WebkitMaskImage: `radial-gradient(ellipse ${ghostAlignment.maskRadiusX}px ${ghostAlignment.maskRadiusY}px at ${ghostAlignment.originX}px ${ghostAlignment.originY}px, #000 55%, transparent 100%)`,
                              maskImage: `radial-gradient(ellipse ${ghostAlignment.maskRadiusX}px ${ghostAlignment.maskRadiusY}px at ${ghostAlignment.originX}px ${ghostAlignment.originY}px, #000 55%, transparent 100%)`,
                            }
                          : {}),
                      }}
                    />
                  )}

                  {/* ズーム倍率表示(写真カルテ Phase 2)。getUserMediaのzoom制約はiPadOS Safariで
                      機能しないため実際のロックではなく表示のみ。ページ全体のピンチズームは
                      viewport設定(app/layout.tsx)で既に無効化済み。 */}
                  {capture.cameraStatus === 'ready' && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute', right: '14px', bottom: '14px', zIndex: 1,
                        display: 'flex', alignItems: 'center', gap: '4px',
                        background: 'rgba(20,16,12,0.75)', color: '#fff',
                        padding: '6px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
                      }}
                    >
                      <Lock size={12} strokeWidth={2.2} />
                      1x
                    </div>
                  )}

                  {!bodyPartSelected && capture.cameraStatus === 'ready' && (
                    <p style={{
                      position: 'absolute', inset: 0, margin: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 40px',
                      color: '#fff', fontSize: '13px',
                    }}>
                      上部のタブから部位を選択してください
                    </p>
                  )}

                  {showGuideOverlay && (
                    <>
                      {faceGuideMode === 'none' ? (
                        <div
                          style={{
                            position: 'absolute', left: '18%', right: '18%', top: '30%', height: '28%',
                            border: '2px dashed rgba(255,255,255,0.7)', borderRadius: '8px', pointerEvents: 'none',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: 'absolute', left: '28%', right: '28%', top: '14%', bottom: '18%',
                            border: `2px dashed ${faceGuideMessage ? 'rgba(255,255,255,0.7)' : PALETTE.gold}`,
                            borderRadius: '50%', pointerEvents: 'none',
                          }}
                        />
                      )}

                      {/* 水平器/ジャイロガイド(写真カルテ Phase 2)の目標クロス。実機での校正前提の
                          暫定表示につき、位置は画面中央付近に固定し、色(緑=整った/白=未整列)のみで
                          状態を伝える(顔検出結果に応じた動的な位置追従は今回のPhaseでは行わない)。 */}
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute', left: '50%', top: '40%', transform: 'translate(-50%, -50%)',
                          pointerEvents: 'none',
                        }}
                      >
                        <Crosshair size={40} strokeWidth={1.6} color={crosshairAligned ? '#4ADE80' : 'rgba(255,255,255,0.85)'} />
                      </div>
                    </>
                  )}

                  {/* 自動保存フィードバック(2026-09-17): 1.5秒の自動確定タイマー完了の瞬間だけ
                      出す短時間の演出。「サーバー保存の成功」ではなく「この撮影がローカルで
                      確定した」ことを示す(uploadError発生時は上のeffectで即座に消える)。 */}
                  {savedFlash && (
                    <div aria-hidden="true" style={{
                      position: 'absolute', inset: 0, pointerEvents: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      <div style={{
                        position: 'absolute', inset: 0, background: '#fff',
                        animation: 'photoSavedFlash 0.5s ease-out forwards',
                      }} />
                      <div style={{
                        position: 'relative', width: '64px', height: '64px', borderRadius: '50%',
                        background: 'rgba(20,16,12,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        animation: 'photoSavedCheck 0.6s ease-out forwards',
                      }}>
                        <CheckCircle2 size={36} strokeWidth={2} color="#4ADE80" />
                      </div>
                    </div>
                  )}

                  {capture.cameraStatus === 'requesting' && (
                    <p style={{
                      position: 'absolute', inset: 0, margin: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px',
                    }}>
                      カメラを起動しています…
                    </p>
                  )}

                  {/* iOS13+のみ: ジャイロ利用にはユーザーの直接タップが必要なため、
                      未リクエストの間だけ明示的なボタンを出す(useEffect起点では権限を得られない)。 */}
                  {tilt.permission === 'unrequested' && capture.cameraStatus === 'ready' && (
                    <button
                      type="button"
                      onClick={() => { void tilt.requestPermission() }}
                      style={{
                        position: 'absolute', left: '50%', top: '14px', transform: 'translateX(-50%)',
                        padding: '8px 14px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                        background: 'rgba(20,16,12,0.78)', color: '#fff', fontSize: '12px', fontWeight: 700,
                      }}
                    >
                      水平ガイドを有効にする
                    </button>
                  )}
                </>
              )}
            </div>

          </div>

          {/* ── ガイドメッセージバー(映像の外・下、視認性向上のため濃色ピルではなく
              専用の帯として常に一定のコントラストを確保する) ── */}
          {showGuideOverlay && guideMessageText && (
            <div style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '12px 20px', borderTop: `1px solid ${PALETTE.border}`, background: PALETTE.bg,
            }}>
              <Crosshair size={16} strokeWidth={1.8} color={guideMessageIsSuccess ? '#22C55E' : PALETTE.gold} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>{guideMessageText}</span>
            </div>
          )}

          {/* ── ゴーストパネル(写真カルテUI改善 Part 1・画面下部へ移動、2026-09-18
              ユーザー承認)。以前は映像の右側に固定幅260pxのサイドバーとして表示していたが、
              シャッターを画面右側中央へ移動するスペースを確保するため、横一列の帯として
              画面下部へ移した。ゴーストの自動位置・サイズ合わせ(ghostAlignment)・マスク・
              手動スライダーの計算ロジック自体(ghost.opacityPercent/scalePercent等の値・
              onChangeハンドラ)には一切手を加えていない、見た目の配置のみの変更。
              日付候補リストは下部の帯に対して上に開くよう位置を変更した(画面下端で
              切れるのを防ぐため)。 ── */}
          {showGuideOverlay && (
            <div style={{
              flexShrink: 0, borderTop: `1px solid ${PALETTE.border}`, background: PALETTE.bg,
              padding: '12px 20px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>ゴースト</span>
                <ToggleSwitch checked={ghost.enabled} onChange={ghost.setEnabled} />
              </div>

              {ghost.enabled && (
                <>
                  <div style={{ width: '170px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: PALETTE.muted, marginBottom: '4px' }}>
                      <span>強さ</span>
                      <span>{ghost.opacityPercent}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={ghost.opacityPercent}
                      onChange={e => ghost.setOpacityPercent(Number(e.target.value))}
                      style={{ width: '100%', accentColor: PALETTE.gold }}
                    />
                  </div>

                  <div style={{ width: '210px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: PALETTE.muted, marginBottom: '4px' }}>
                      <span>サイズ(微調整)</span>
                      <span>{ghost.scalePercent}%</span>
                    </div>
                    <input
                      type="range"
                      min={GHOST_SCALE_MIN_PERCENT}
                      max={GHOST_SCALE_MAX_PERCENT}
                      value={ghost.scalePercent}
                      onChange={e => ghost.setScalePercent(Number(e.target.value))}
                      style={{ width: '100%', accentColor: PALETTE.gold }}
                    />
                    <p style={{ margin: '4px 0 0', fontSize: '10px', color: ghostAlignment ? '#22C55E' : PALETTE.muted }}>
                      {ghostAlignment ? '● 自動調整中' : '○ 顔未検出(手動調整)'}
                    </p>
                  </div>

                  <div style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
                    {ghost.activePhoto ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: PALETTE.muted }}>前回</span>
                        <span style={{ fontSize: '13px', color: PALETTE.text }}>
                          {formatGhostDateLabel(ghost.activePhoto.takenAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDateListOpen(v => !v)}
                          aria-label="日付を選び直す"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.gold, padding: '4px', flexShrink: 0 }}
                        >
                          <Calendar size={18} strokeWidth={1.8} />
                        </button>
                      </div>
                    ) : ghost.candidatesLoading ? (
                      <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>
                    ) : (
                      <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>前回の写真がありません</p>
                    )}

                    {dateListOpen && (
                      <div style={{
                        position: 'absolute', bottom: '100%', right: 0, marginBottom: '8px',
                        display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '220px', overflowY: 'auto',
                        minWidth: '200px', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
                        borderRadius: '10px', padding: '8px', boxShadow: '0 -4px 16px rgba(0,0,0,0.15)', zIndex: 6,
                      }}>
                        <button
                          type="button"
                          onClick={() => { ghost.selectPhoto(null); setDateListOpen(false) }}
                          style={dateOptionStyle(ghost.selectedPhotoId === null)}
                        >
                          自動(前回)
                        </button>
                        {ghost.candidates.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { ghost.selectPhoto(c.id); setDateListOpen(false) }}
                            style={dateOptionStyle(ghost.selectedPhotoId === c.id)}
                          >
                            {formatGhostDateLabel(c.takenAt)}
                          </button>
                        ))}
                        {ghost.candidates.length === 0 && !ghost.candidatesLoading && (
                          <p style={{ margin: '4px 0 0', fontSize: '11px', color: PALETTE.muted }}>他の日付の写真はありません</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── シャッター(写真カルテUI改善 Part 1・画面右側中央へ移動、2026-09-18
              ユーザー承認)。以前は画面下部で水平方向中央に配置していたが、片手操作時の
              親指の届きやすさを優先し、画面全体(fixed inset:0の最外殻コンテナ)を基準に
              右端中央へ絶対配置するオーバーレイに変更した。表示条件(cameraStatus==='ready')・
              無効化条件(!bodyPartSelected)・onClickハンドラは無変更。 ── */}
          {capture.cameraStatus === 'ready' && (
            <button
              type="button"
              onClick={() => { void capture.shutter() }}
              disabled={!bodyPartSelected}
              aria-label="シャッター"
              style={{
                position: 'absolute', right: 'max(20px, env(safe-area-inset-right))', top: '50%',
                transform: 'translateY(-50%)', zIndex: 5,
                width: '68px', height: '68px', borderRadius: '50%', cursor: bodyPartSelected ? 'pointer' : 'not-allowed',
                background: PALETTE.bg, border: `3px solid ${bodyPartSelected ? PALETTE.gold : PALETTE.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
              }}
            >
              <Camera size={22} strokeWidth={1.8} color={bodyPartSelected ? PALETTE.gold : PALETTE.muted} />
            </button>
          )}
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '24px' }}>
          <div style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 撮影日の指定(過去写真登録・2026-09-17設計調査で確定)。未指定(既定)の間は
                既存どおりアップロード時刻がそのまま保存日時になる(既存動作を維持)。
                過去の写真をまとめて登録する場合のみ、ここで撮影日(日付のみ)を選ぶ。 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '12px', color: PALETTE.muted, whiteSpace: 'nowrap' }}>
                撮影日(任意)
              </label>
              <input
                type="date"
                value={takenAtDateInput}
                max={todayDateInputValue()}
                onChange={(e) => {
                  const v = e.target.value
                  setTakenAtDateInput(v)
                  capture.setTakenAtOverride(v ? `${v}T12:00:00.000Z` : null)
                }}
                style={{
                  flex: 1, minWidth: '140px', padding: '8px 10px', borderRadius: '8px',
                  border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.text,
                  fontSize: '13px',
                }}
              />
              {takenAtDateInput && (
                <button
                  type="button"
                  onClick={() => { setTakenAtDateInput(''); capture.setTakenAtOverride(null) }}
                  style={{
                    padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'none',
                    color: PALETTE.muted, fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  今日に戻す
                </button>
              )}
            </div>
            {takenAtDateInput && (
              <p style={{ margin: 0, fontSize: '11px', color: PALETTE.muted }}>
                この日付({takenAtDateInput})で保存されます。空欄に戻すと本日の日時で保存されます。
              </p>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!bodyPartSelected || pickerBusy}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '18px', borderRadius: '12px', fontSize: '14px', fontWeight: 700,
                border: `1.5px solid ${bodyPartSelected ? PALETTE.gold : PALETTE.border}`,
                background: bodyPartSelected ? PALETTE.card : 'transparent',
                color: bodyPartSelected ? PALETTE.text : PALETTE.muted,
                cursor: bodyPartSelected && !pickerBusy ? 'pointer' : 'not-allowed',
                opacity: pickerBusy ? 0.6 : 1,
              }}
            >
              <ImagePlus size={18} strokeWidth={1.6} color={PALETTE.gold} />
              {pickerBusy ? '読み込み中…' : '写真ライブラリから選ぶ'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { void handleFileChange(e) }}
            />
          </div>
        </div>
      )}

      {(capture.justSaved && capture.reviewPhase !== 'reviewing') || capture.uploadError ? (
        <div style={{ flexShrink: 0, padding: '0 24px 16px' }}>
          {capture.justSaved && capture.reviewPhase !== 'reviewing' && (
            <p style={{ margin: 0, fontSize: '12px', color: PALETTE.gold, textAlign: 'center' }}>
              保存しました。続けて撮影・追加できます。
            </p>
          )}
          {capture.uploadError && (
            <p style={{ margin: 0, fontSize: '12px', color: '#c0392b', textAlign: 'center' }}>
              保存に失敗しました: {capture.uploadError}
            </p>
          )}
        </div>
      ) : null}

      <style>{`
        @keyframes photoSavedFlash { 0% { opacity: 0.55 } 100% { opacity: 0 } }
        @keyframes photoSavedCheck {
          0%   { opacity: 0; transform: scale(0.6) }
          30%  { opacity: 1; transform: scale(1.05) }
          60%  { opacity: 1; transform: scale(1) }
          100% { opacity: 0; transform: scale(1) }
        }
      `}</style>
    </div>
  )
}

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
 * 部位(正面/斜め/顎/額)の選択必須化: usePhotoCaptureへは initialBodyPart='' で渡し、
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
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, RotateCcw, X } from 'lucide-react'
import { usePhotoCapture } from '@/hooks/usePhotoCapture'
import { useFaceGuide } from '@/hooks/useFaceGuide'
import { pickFaceGuideMessage, type FaceGuideMode } from '@/lib/photos/faceGuide'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { IPAD_KARTE_ANGLES, type IpadKarteAngleId } from './ipadKarteData'

/**
 * 撮影ガイド強化(PHASE IPAD-PHOTO-CAPTURE-3・2026-09-15、久保田さん確認済みの設計)。
 * 正面: 大きさ・位置・傾きの3種フィードバック。右斜め・左斜め: 大きさ・位置のみ
 * (傾きの基準が未確定のため今回は見送り)。額: 顔検出自体を行わず静的な枠ガイドのみ
 * (額クローズアップは目・鼻・口が写らずモデルが顔として認識できない可能性が高いため)。
 */
function faceGuideModeFor(bodyPart: string): FaceGuideMode {
  if (bodyPart === 'face_front') return 'full'
  if (bodyPart === 'face_right' || bodyPart === 'face_left') return 'position_size'
  return 'none'
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

export default function IpadPhotoCaptureModal({ customerId, visitId, intent, onClose, onSaved }: Props) {
  const capture = usePhotoCapture({ customerId, visitId, initialBodyPart: '' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pickerBusy, setPickerBusy] = useState(false)

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

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(20,16,12,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        style={{
          background: PALETTE.bg, borderRadius: '16px', width: '100%', maxWidth: '480px',
          maxHeight: '92vh', overflowY: 'auto', padding: '24px',
          display: 'flex', flexDirection: 'column', gap: '18px',
          border: `1px solid ${PALETTE.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p
            style={{
              margin: 0, fontSize: '15px', color: PALETTE.gold, letterSpacing: '0.02em',
              fontFamily: headingFont.style.fontFamily,
            }}
          >
            {intent === 'camera' ? '撮影する' : '選択して追加'}
          </p>
          <button
            type="button"
            onClick={handleClose}
            aria-label="閉じる"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted, padding: '4px' }}
          >
            <X size={22} strokeWidth={2} />
          </button>
        </div>

        {/* 部位選択(必須)。枚数によらず、いずれかを選ぶまで下の撮影/選択操作は無効化する。 */}
        <div>
          <p style={{ margin: '0 0 8px', fontSize: '12px', color: PALETTE.muted }}>
            部位を選択してください{!bodyPartSelected && '(未選択)'}
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {IPAD_KARTE_ANGLES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => capture.setBodyPart(a.id)}
                style={{
                  padding: '8px 16px', borderRadius: '999px', cursor: 'pointer',
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

        {/* ── レビュー中(シャッター後/ファイル選択後、自動確定を待っている間) ── */}
        {capture.reviewPhase === 'reviewing' && capture.previewUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capture.previewUrl} alt="撮影プレビュー" style={{ width: '100%', display: 'block' }} />
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, textAlign: 'center' }}>
              このまま自動的に保存されます
            </p>
            <button
              type="button"
              onClick={capture.retake}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '12px', borderRadius: '10px', border: `1.5px solid ${PALETTE.border}`,
                background: 'none', color: PALETTE.text, cursor: 'pointer',
              }}
            >
              <RotateCcw size={16} strokeWidth={1.8} />
              撮り直す
            </button>
          </div>
        ) : intent === 'camera' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {capture.cameraStatus === 'error' ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ fontSize: '13px', color: PALETTE.text, marginBottom: '12px', lineHeight: 1.6 }}>
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
                      background: 'none', color: PALETTE.text, cursor: 'pointer',
                    }}
                  >
                    もう一度試す
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  position: 'relative', borderRadius: '12px', overflow: 'hidden',
                  background: '#000', aspectRatio: '4 / 3',
                }}
              >
                <video
                  ref={capture.videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {/* ゴースト(前回写真の半透明重ね表示)は今回のスコープ外(2026-09-15ユーザー指示)。
                    usePhotoCapture.ts側は土台としてそのまま流用しているため内部では引き続き
                    取得され続けるが(ghostUrl/ghostOpacityLevel)、未調整のまま本番で誤って
                    使われることのないよう、UIとしては意図的に描画しない。正式に作るかどうかは
                    別途相談の上で判断する。 */}

                {/* 撮影ガイド強化(PHASE IPAD-PHOTO-CAPTURE-3・2026-09-15)。部位が選択済みの
                    間のみ表示する(未選択のうちは何も描画しない)。 */}
                {bodyPartSelected && capture.cameraStatus === 'ready' && (
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

                    {faceGuideMode === 'none' ? (
                      <p style={{
                        position: 'absolute', left: 0, right: 0, bottom: '10px', margin: 0,
                        textAlign: 'center', fontSize: '12px', color: '#fff',
                      }}>
                        額を枠内に収めてください
                      </p>
                    ) : (
                      <p style={{
                        position: 'absolute', left: 0, right: 0, bottom: '10px', margin: 0,
                        textAlign: 'center', fontSize: '12px', fontWeight: 700,
                        color: faceGuideMessage ? '#fff' : PALETTE.gold,
                      }}>
                        {faceGuideMessage ?? (faceGuide.state?.faceDetected ? '✓ 良い構図です' : '')}
                      </p>
                    )}
                  </>
                )}

                {capture.cameraStatus === 'requesting' && (
                  <p style={{
                    position: 'absolute', inset: 0, margin: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px',
                  }}>
                    カメラを起動しています…
                  </p>
                )}
              </div>
            )}
            {capture.cameraStatus === 'ready' && (
              <button
                type="button"
                onClick={() => { void capture.shutter() }}
                disabled={!bodyPartSelected}
                style={{
                  padding: '14px', borderRadius: '10px', border: 'none', fontWeight: 700, fontSize: '14px',
                  background: bodyPartSelected ? PALETTE.gold : PALETTE.border,
                  color: bodyPartSelected ? '#fff' : PALETTE.muted,
                  cursor: bodyPartSelected ? 'pointer' : 'not-allowed',
                }}
              >
                <Camera size={16} strokeWidth={1.8} style={{ verticalAlign: '-3px', marginRight: '6px' }} />
                シャッター
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
        )}

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
    </div>
  )
}

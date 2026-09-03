'use client'
/**
 * PhotoCaptureView.tsx — 写真カルテ Phase1「撮影画面」
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1節(撮影画面)・1-8節〜1-10節。
 * ロジック本体(ゴースト取得・シャッター確定フロー・カメラエラー分類)は
 * src/lib/photos/*.ts / src/hooks/usePhotoCapture.ts に委譲し、このコンポーネントは
 * それらを画面に配置するだけの薄いレイヤーに留める。
 *
 * 今回のスコープ外(未実装): Afterチェックリストの完全実装・比較画面・タイムライン・
 * 再撮影時の確定済み写真の置換(いずれも別ステップで実装予定)。
 */
import { useEffect, useRef } from 'react'
import { usePhotoCapture, GHOST_OPACITY_VALUE, type GhostOpacityLevel } from '@/hooks/usePhotoCapture'
import { BODY_PART_OPTIONS, bodyPartLabel } from '@/lib/photos/bodyParts'
import type { CapturePhotoType } from '@/lib/photos/captureConfirmFlow'
import CameraErrorScreen from './CameraErrorScreen'

interface Props {
  customerId:      string
  visitId:         string | null
  initialBodyPart?: string
  onClose:         () => void
}

const OPACITY_LEVELS: { level: GhostOpacityLevel; label: string }[] = [
  { level: 'off',    label: 'OFF' },
  { level: 'weak',   label: '25%' },
  { level: 'strong', label: '50%' },
]

function segButton(active: boolean): React.CSSProperties {
  return {
    padding:      '6px 14px',
    borderRadius: '999px',
    fontSize:     '12px',
    fontWeight:   600,
    border:       active ? 'none' : '1px solid rgba(255,255,255,0.35)',
    background:   active ? '#4878A8' : 'transparent',
    color:        '#fff',
    cursor:       'pointer',
  }
}

export default function PhotoCaptureView({ customerId, visitId, initialBodyPart, onClose }: Props) {
  const cap = usePhotoCapture({
    customerId,
    visitId,
    initialBodyPart: initialBodyPart ?? BODY_PART_OPTIONS[0].id,
  })

  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void cap.startCamera()
    return () => cap.stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ghostOpacity = GHOST_OPACITY_VALUE[cap.ghostOpacityLevel]
  const hasGhost = !!cap.ghost && !!cap.ghostUrl

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', zIndex: 200,
      display: 'flex', flexDirection: 'column', color: '#fff',
    }}>
      {/* ── A: ヘッダー(閉じる・現在の部位ラベル・Before/Afterトグル) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', flexShrink: 0,
      }}>
        <button type="button" onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>
          ✕
        </button>
        <span style={{ fontSize: '13px', fontWeight: 600 }}>{bodyPartLabel(cap.bodyPart)}</span>
        <div style={{ display: 'flex', borderRadius: '999px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.35)' }}>
          {(['before', 'after'] as CapturePhotoType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => cap.setPhotoType(t)}
              style={{
                padding: '6px 12px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                background: cap.photoType === t ? '#4878A8' : 'transparent',
                color: '#fff',
              }}
            >
              {t === 'before' ? '施術前' : '施術後'}
            </button>
          ))}
        </div>
      </div>

      {/* ── カメラ本体 or エラー画面(常時position:relativeのコンテナ。
            撮影後の確認オーバーレイはこの中でカメラの成否に関わらず最前面に表示する、必須修正2) ── */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden', background: '#111' }}>
        {cap.cameraStatus === 'error' && cap.cameraErrorKind ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 16px' }}>
            <CameraErrorScreen
              kind={cap.cameraErrorKind}
              onRetry={() => void cap.retryCamera()}
              onSelectFile={(file) => void cap.captureFromFile(file)}
            />
          </div>
        ) : (
          <>
            {/* ── B/C/D: プレビュー + 静的ガイド + ゴースト ── */}
            <video
              ref={cap.videoRef}
              playsInline
              muted
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {/* ゴースト(前回写真)レイヤー: video の上に重ねるDOMレイヤーのみ。
                captureFrame.ts のシャッター処理はこの<img>を一切参照しないため、
                保存画像に焼き込まれることは構造的にない(1-4節)。 */}
            {hasGhost && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cap.ghostUrl ?? undefined}
                alt=""
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  objectFit: 'cover', opacity: ghostOpacity, pointerEvents: 'none',
                }}
              />
            )}

            {/* 静的ガイド(輪郭目安+中央十字線)。ゴーストの有無に関わらず常時表示(1-6節) */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              <ellipse cx="50" cy="46" rx="26" ry="34" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5" strokeDasharray="2 2" />
              <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
              <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
            </svg>

            {cap.cameraStatus === 'requesting' && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '13px', color: '#B8C4D0',
              }}>
                カメラを起動しています…
              </div>
            )}
          </>
        )}

        {/* ── 撮影後の確認(フリーズ表示、1-8節)。必須修正2:
              カメラが正常/エラーいずれの状態でも(=ファイル選択フォールバック経由でも)
              reviewPhase==='reviewing'なら常に最前面に表示する ── */}
        {cap.reviewPhase === 'reviewing' && cap.previewUrl && (
          <div style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cap.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button
              type="button"
              onClick={cap.retake}
              style={{
                position: 'absolute', right: '16px', bottom: '16px',
                padding: '8px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
                cursor: 'pointer',
              }}
            >
              撮り直す
            </button>
          </div>
        )}
      </div>

      {/* ── アップロード結果フィードバック。必須修正2: カメラの成否に関わらず常に表示する ── */}
      {cap.uploadError && (
        <p style={{ padding: '6px 14px', fontSize: '12px', color: '#F0A0A8' }}>
          ⚠️ {cap.uploadError}
        </p>
      )}
      {cap.justSaved && !cap.uploadError && (
        <p style={{ padding: '6px 14px', fontSize: '12px', color: '#9BE0B0' }}>
          ✅ 保存しました
        </p>
      )}

      {/* ── ゴースト操作列・部位選択チップ・シャッター: カメラ正常時のみ(従来どおり、今回対象外) ── */}
      {cap.cameraStatus !== 'error' && (
        <>
          {/* ── D: ゴースト操作列(基準は前回→初回の自動フォールバックのみ、今回スコープ) ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '8px 14px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '11px', color: '#B8C4D0' }}>
              ゴースト: {cap.ghostLoading ? '取得中…' : hasGhost ? (cap.ghost?.basis === 'first' ? '初回' : cap.ghost?.basis === 'same_visit_before' ? '本日Before' : '前回') : 'なし'}
            </span>
            {OPACITY_LEVELS.map(({ level, label }) => (
              <button
                key={level}
                type="button"
                disabled={!hasGhost}
                onClick={() => cap.setGhostOpacityLevel(level)}
                style={{ ...segButton(cap.ghostOpacityLevel === level), opacity: hasGhost ? 1 : 0.35 }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── E: 部位選択チップ(横スクロール) ── */}
          <div style={{
            display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 14px 10px',
            flexShrink: 0, WebkitOverflowScrolling: 'touch',
          }}>
            {BODY_PART_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => cap.setBodyPart(opt.id)}
                style={{
                  flexShrink: 0, padding: '7px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                  border: cap.bodyPart === opt.id ? 'none' : '1px solid rgba(255,255,255,0.3)',
                  background: cap.bodyPart === opt.id ? '#4878A8' : 'transparent',
                  color: '#fff',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* ── F: シャッター ── */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 26px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => void cap.shutter()}
              disabled={cap.cameraStatus !== 'ready' || cap.reviewPhase === 'reviewing'}
              aria-label="シャッター"
              style={{
                width: '68px', height: '68px', borderRadius: '50%',
                background: '#fff', border: '4px solid rgba(255,255,255,0.4)',
                opacity: cap.cameraStatus === 'ready' && cap.reviewPhase !== 'reviewing' ? 1 : 0.4,
                cursor: 'pointer',
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

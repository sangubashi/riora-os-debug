'use client'
/**
 * PhotoCompareScreen.tsx — 写真カルテ Before/After比較UI(スライダー/並列、2026-09-17)。
 *
 * 2026-10-02拡張(ユーザー依頼):
 *  - レイアウト: 上=比較画像、下=「撮影日タブ + その日のアングル別サムネイル」パネル。
 *    「左(前)に設定 / 右(後)に設定」で対象側を選び、日付タブ→サムネイルのタップで
 *    その側の写真を差し替える(旧: ヘッダーの日付ポップアップ)。
 *  - 左右の表示ラベルは「前回/今回」ではなく撮影日(+アングル)で表示する。
 *  - 並列モードは左右それぞれ独立したズーム・パン(useSyncedZoomPanを左右で別々に呼ぶ)。
 *    スライダーモードは重ね合わせのため従来通り1つのズームを共有する。
 *  - アングル修正: サムネイルのアングルを後から直せる(PATCH .../photos/[photoId]、
 *    実体はbody_part。語彙は src/lib/photos/photoAngle.ts)。
 *
 * 撮影用ゴーストUI(IpadPhotoCaptureModal.tsx)とは完全に別画面。対象は保存済み写真
 * (既存の GET /api/customers/[id]/photos・signed-url API)のみで、カメラ・ゴースト・
 * ジャイロ・メモ・AI・LINEには関与しない。権限チェックは既存API(authedFetch経由)に委ねる。
 *
 * 画像読み込みガード(2026-09-28): signed URL取得失敗・<img>のonErrorいずれも
 * プレースホルダーを表示し、操作(ズーム・スライダー)は画像の状態に依存しない。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Calendar, ImageOff, Maximize2, Minimize2, MoveHorizontal, Pencil, Rows3, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import {
  listCustomerPhotosTimeline, getBatchSignedUrls, updatePhotoAngle, type TimelinePhoto,
} from '@/lib/photos/photoApiClient'
import { pickInitialComparisonPair, formatPhotoDateLabel } from '@/lib/photos/comparePairSelection'
import type { ComparisonPair } from '@/lib/photos/comparisonSelection'
import {
  PHOTO_ANGLES, angleOfBodyPart, angleLabelOfPhoto, bodyPartOfAngle, photoDayKey,
  listPhotoDays, listPhotosOfDay, formatDayTab, type PhotoAngle,
} from '@/lib/photos/photoAngle'
import { useSyncedZoomPan } from '@/hooks/useSyncedZoomPan'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

type ViewMode = 'slider' | 'sideBySide'
type PairSide = 'reference' | 'current'

interface Props {
  customerId: string
  /** 呼び出し元が見ていた角度タブ等。比較可能ならこの部位を初期表示に使う(同じアングル優先)。 */
  initialBodyPart?: string | null
  onClose: () => void
}

// objectFitはcontain(写真全体を必ず表示する。coverだと額・顎が切り取られる、CLAUDE.md参照)。
const imgBaseStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
  willChange: 'transform', userSelect: 'none', pointerEvents: 'none',
}

const SIDE_LABEL: Record<PairSide, string> = { reference: '左（前）', current: '右（後）' }

function PhotoLoadErrorPlaceholder() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: '10px',
        alignItems: 'center', justifyContent: 'center', background: '#14100c',
        color: 'rgba(255,255,255,0.7)', fontSize: '12px', textAlign: 'center', padding: '16px',
      }}
    >
      <ImageOff size={26} strokeWidth={1.3} color={PALETTE.gold} />
      写真を読み込めませんでした
    </div>
  )
}

/** 比較画像の左右ラベル: 撮影日(同日同士は時刻も)+アングル。「前回/今回」は使わない。 */
function captionOf(photo: TimelinePhoto | undefined, other: TimelinePhoto | undefined): string {
  if (!photo) return ''
  const l = formatPhotoDateLabel(photo.takenAt)
  const sameDay = !!other && photoDayKey(other) === photoDayKey(photo)
  return `${l.dateStr}${sameDay && l.timeStr ? ` ${l.timeStr}` : ''} ${angleLabelOfPhoto(photo)}`
}

export default function PhotoCompareScreen({ customerId, initialBodyPart, onClose }: Props) {
  const [photos, setPhotos] = useState<TimelinePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [pair, setPair] = useState<ComparisonPair | null>(null)
  const [urls, setUrls] = useState<{ reference?: string; current?: string }>({})
  const [attempted, setAttempted] = useState<{ reference: boolean; current: boolean }>({ reference: false, current: false })
  const [imgError, setImgError] = useState<{ reference?: boolean; current?: boolean }>({})

  const [viewMode, setViewMode] = useState<ViewMode>('slider')
  const [sliderPercent, setSliderPercent] = useState(50)
  const [fullscreen, setFullscreen] = useState(false)

  // 下部パネル: 設定対象の側・表示中の撮影日・サムネイルURL・アングル修正モード
  const [targetSide, setTargetSide] = useState<PairSide>('current')
  const [dayKey, setDayKey] = useState<string | null>(null)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const [angleEdit, setAngleEdit] = useState(false)
  const [angleError, setAngleError] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const sliderAreaRef = useRef<HTMLDivElement | null>(null)
  const draggingHandleRef = useRef(false)
  const zoomShared = useSyncedZoomPan()      // スライダー比較: 重ね合わせのため共有
  const zoomReference = useSyncedZoomPan()   // 並列比較: 左右で独立
  const zoomCurrent = useSyncedZoomPan()
  const zoomOf = { reference: zoomReference, current: zoomCurrent }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listCustomerPhotosTimeline(customerId)
      .then(list => {
        if (cancelled) return
        setPhotos(list)
        setPair(pickInitialComparisonPair(list, initialBodyPart ?? null))
      })
      .catch(() => {
        if (cancelled) return
        setPhotos([])
        setPair(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  // 左右それぞれ、写真が変わった側だけ署名URL取得・ズームのリセットを行う(反対側の拡大状態は保つ)。
  const referenceId = pair?.reference.id
  const currentId = pair?.current.id
  useEffect(() => {
    setImgError(prev => ({ ...prev, reference: false }))
    setAttempted(prev => ({ ...prev, reference: false }))
    zoomReference.reset()
    zoomShared.reset()
    if (!referenceId) { setUrls(prev => ({ ...prev, reference: undefined })); return undefined }
    let cancelled = false
    getBatchSignedUrls(customerId, [referenceId], 'detail')
      .then(map => { if (!cancelled) setUrls(prev => ({ ...prev, reference: map[referenceId] })) })
      .catch(() => { if (!cancelled) setUrls(prev => ({ ...prev, reference: undefined })) })
      .finally(() => { if (!cancelled) setAttempted(prev => ({ ...prev, reference: true })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, referenceId])
  useEffect(() => {
    setImgError(prev => ({ ...prev, current: false }))
    setAttempted(prev => ({ ...prev, current: false }))
    zoomCurrent.reset()
    zoomShared.reset()
    if (!currentId) { setUrls(prev => ({ ...prev, current: undefined })); return undefined }
    let cancelled = false
    getBatchSignedUrls(customerId, [currentId], 'detail')
      .then(map => { if (!cancelled) setUrls(prev => ({ ...prev, current: map[currentId] })) })
      .catch(() => { if (!cancelled) setUrls(prev => ({ ...prev, current: undefined })) })
      .finally(() => { if (!cancelled) setAttempted(prev => ({ ...prev, current: true })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, currentId])

  const referenceFailed = imgError.reference || (attempted.reference && !urls.reference)
  const currentFailed   = imgError.current   || (attempted.current   && !urls.current)

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = async () => {
    if (!fullscreen) {
      try { await rootRef.current?.requestFullscreen?.() } catch { /* 非対応環境はCSSのみで表現 */ }
      setFullscreen(true)
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* 同上 */ }
      setFullscreen(false)
    }
  }

  // ── 下部パネル ─────────────────────────────────────────────
  const days = useMemo(() => listPhotoDays(photos), [photos])
  // 設定対象の側が変わった/写真が変わったら、その側の撮影日タブへ追従する。
  const targetPhotoId = pair?.[targetSide].id
  useEffect(() => {
    const p = pair?.[targetSide]
    if (p) setDayKey(photoDayKey(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSide, targetPhotoId])

  const dayPhotos = useMemo(() => (dayKey ? listPhotosOfDay(photos, dayKey) : []), [photos, dayKey])

  // 表示中の日のサムネイル署名URLを取得(取得済みは再取得しない)。
  useEffect(() => {
    const missing = dayPhotos.map(p => p.id).filter(id => !thumbUrls[id])
    if (missing.length === 0) return undefined
    let cancelled = false
    getBatchSignedUrls(customerId, missing, 'thumbnail')
      .then(map => { if (!cancelled) setThumbUrls(prev => ({ ...prev, ...map })) })
      .catch(() => { /* サムネイルが出ないだけで選択操作自体は可能 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, dayPhotos])

  const selectThumbnail = (photo: TimelinePhoto) => {
    if (!pair) return
    setPair({ ...pair, [targetSide]: photo, bodyPart: targetSide === 'current' ? photo.bodyPart : pair.bodyPart })
  }

  const changeAngle = useCallback(async (photo: TimelinePhoto, angle: PhotoAngle) => {
    if (angleOfBodyPart(photo.bodyPart) === angle) return
    setAngleError(null)
    try {
      const bodyPart = await updatePhotoAngle(customerId, photo.id, angle)
      const patch = (p: TimelinePhoto): TimelinePhoto => (p.id === photo.id ? { ...p, bodyPart } : p)
      setPhotos(prev => prev.map(patch))
      setPair(prev => (prev ? { ...prev, reference: patch(prev.reference), current: patch(prev.current) } : prev))
    } catch {
      setAngleError('アングルを更新できませんでした')
    }
  }, [customerId])

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    draggingHandleRef.current = true
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingHandleRef.current || !sliderAreaRef.current) return
    e.stopPropagation()
    const rect = sliderAreaRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setSliderPercent(Math.min(95, Math.max(5, pct)))
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    draggingHandleRef.current = false
  }

  const referenceCaption = captionOf(pair?.reference, pair?.current)
  const currentCaption = captionOf(pair?.current, pair?.reference)

  const renderImage = (side: PairSide, extra: React.CSSProperties, zoomStyle: React.CSSProperties) => {
    const failed = side === 'reference' ? referenceFailed : currentFailed
    const url = urls[side]
    if (failed) return <PhotoLoadErrorPlaceholder />
    if (!url) return null
    return (
      <img
        src={url}
        alt={side === 'reference' ? referenceCaption : currentCaption}
        data-testid={`compare-img-${side}`}
        style={{ ...imgBaseStyle, ...zoomStyle, ...extra }}
        onError={() => setImgError(prev => ({ ...prev, [side]: true }))}
      />
    )
  }

  const renderPane = (side: PairSide) => {
    const z = zoomOf[side]
    return (
      <div
        {...z.handlers}
        data-testid={`compare-pane-${side}`}
        style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'none' }}
      >
        {renderImage(side, {}, z.style)}
        <span style={compareLabelStyle(side === 'reference' ? 'left' : 'right')}>
          {side === 'reference' ? referenceCaption : currentCaption}
        </span>
        {z.isZoomed && (
          <button
            type="button"
            onClick={() => z.reset()}
            onPointerDown={e => e.stopPropagation()}
            aria-label={`${SIDE_LABEL[side]}の拡大をリセット`}
            data-testid={`compare-zoom-reset-${side}`}
            style={{
              position: 'absolute', top: '10px', [side === 'reference' ? 'left' : 'right']: '10px', zIndex: 3,
              display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '999px',
              border: 'none', background: 'rgba(20,16,12,0.65)', color: '#fff', fontSize: '12px', cursor: 'pointer',
            }}
          >
            <RotateCcw size={12} />×{z.scale.toFixed(1)}
          </button>
        )}
      </div>
    )
  }

  const segBtn = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', border: 'none', cursor: 'pointer',
    background: active ? PALETTE.gold : 'transparent', color: active ? '#fff' : PALETTE.text, fontSize: '12px',
  })

  return (
    <div
      ref={rootRef}
      data-testid="photo-compare-screen"
      style={{ position: 'fixed', inset: 0, zIndex: 450, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}
    >
      {!fullscreen && (
        <div
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
            padding: 'max(14px, calc(env(safe-area-inset-top) + 10px)) 24px 12px',
            borderBottom: `1px solid ${PALETTE.border}`, flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: '16px', color: PALETTE.gold, letterSpacing: '0.01em', fontFamily: headingFont.style.fontFamily }}>
              Salon Riora
            </p>
            {pair && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
                  borderRadius: '999px', border: `1px solid ${PALETTE.border}`,
                }}
              >
                <Calendar size={14} strokeWidth={1.8} color={PALETTE.gold} />
                <span style={{ fontSize: '12px', color: PALETTE.text }}>{referenceCaption}</span>
                <span style={{ fontSize: '12px', color: PALETTE.muted }}>→</span>
                <span style={{ fontSize: '12px', color: PALETTE.text }}>{currentCaption}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: `1px solid ${PALETTE.border}`, borderRadius: '999px', overflow: 'hidden' }}>
              <button type="button" data-testid="mode-slider" onClick={() => setViewMode('slider')} style={segBtn(viewMode === 'slider')}>
                <SlidersHorizontal size={14} strokeWidth={1.8} />
                スライダー
              </button>
              <button type="button" data-testid="mode-side" onClick={() => setViewMode('sideBySide')} style={segBtn(viewMode === 'sideBySide')}>
                <Rows3 size={14} strokeWidth={1.8} style={{ transform: 'rotate(90deg)' }} />
                並列
              </button>
            </div>
            <button
              type="button"
              onClick={() => { void toggleFullscreen() }}
              aria-label="全画面表示切り替え"
              style={roundBtnStyle}
            >
              <Maximize2 size={15} strokeWidth={1.8} color={PALETTE.gold} />
            </button>
            <button type="button" onClick={onClose} aria-label="閉じる" style={roundBtnStyle}>
              <X size={16} strokeWidth={2} color={PALETTE.text} />
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: '#000' }}>
        {loading ? (
          <p style={{ position: 'absolute', inset: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px' }}>
            読み込み中…
          </p>
        ) : !pair ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <p style={{ color: '#fff', fontSize: '13px', textAlign: 'center', lineHeight: 1.7 }}>
              比較できる写真がまだありません。<br />
              同じ部位で2回以上撮影された写真が必要です。
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={viewMode}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ position: 'absolute', inset: 0 }}
            >
              {viewMode === 'slider' ? (
                <div
                  ref={sliderAreaRef}
                  {...zoomShared.handlers}
                  data-testid="compare-slider-area"
                  style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
                >
                  {renderImage('current', {}, zoomShared.style)}
                  {referenceFailed ? (
                    <div style={{ ...imgBaseStyle, clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}>
                      <PhotoLoadErrorPlaceholder />
                    </div>
                  ) : renderImage('reference', { clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }, zoomShared.style)}
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute', top: 0, bottom: 0, left: `${sliderPercent}%`,
                      width: '2px', marginLeft: '-1px', background: 'rgba(255,255,255,0.85)', pointerEvents: 'none',
                    }}
                  />
                  <div
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    role="slider"
                    aria-label="比較スライダー"
                    aria-valuemin={5}
                    aria-valuemax={95}
                    aria-valuenow={Math.round(sliderPercent)}
                    style={{
                      position: 'absolute', top: '50%', left: `${sliderPercent}%`, transform: 'translate(-50%, -50%)',
                      width: '44px', height: '44px', borderRadius: '50%', touchAction: 'none',
                      background: '#fff', border: `2px solid ${PALETTE.gold}`, cursor: 'ew-resize',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                    }}
                  >
                    <MoveHorizontal size={18} strokeWidth={2} color={PALETTE.gold} />
                  </div>
                  <span style={compareLabelStyle('left')}>{referenceCaption}</span>
                  <span style={compareLabelStyle('right')}>{currentCaption}</span>
                </div>
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: '2px' }}>
                  {renderPane('reference')}
                  {renderPane('current')}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {fullscreen && (
          <button
            type="button"
            onClick={() => { void toggleFullscreen() }}
            aria-label="全画面表示を終了"
            style={{
              position: 'absolute', top: '14px', right: '14px', zIndex: 5,
              width: '38px', height: '38px', borderRadius: '50%', border: 'none',
              background: 'rgba(20,16,12,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <Minimize2 size={16} strokeWidth={2} color="#fff" />
          </button>
        )}
      </div>

      {/* 下部パネル: 設定する側 → 撮影日タブ → その日のアングル別サムネイル */}
      {!fullscreen && pair && (
        <div
          data-testid="compare-bottom-panel"
          style={{
            flexShrink: 0, borderTop: `1px solid ${PALETTE.border}`, background: PALETTE.card,
            padding: '10px 16px max(10px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: `1px solid ${PALETTE.border}`, borderRadius: '999px', overflow: 'hidden' }}>
              {(['reference', 'current'] as const).map(side => (
                <button
                  key={side}
                  type="button"
                  data-testid={`target-${side}`}
                  onClick={() => setTargetSide(side)}
                  style={{ ...segBtn(targetSide === side), padding: '6px 12px' }}
                >
                  {SIDE_LABEL[side]}に設定
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="angle-edit-toggle"
              onClick={() => { setAngleEdit(v => !v); setAngleError(null) }}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '999px',
                border: `1px solid ${PALETTE.border}`, cursor: 'pointer', fontSize: '12px',
                background: angleEdit ? PALETTE.gold : 'transparent', color: angleEdit ? '#fff' : PALETTE.text,
              }}
            >
              <Pencil size={12} />アングル修正
            </button>
          </div>

          <div role="tablist" aria-label="撮影日" data-testid="day-tabs" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
            {days.map(d => (
              <button
                key={d.dayKey}
                type="button"
                role="tab"
                aria-selected={d.dayKey === dayKey}
                data-testid={`day-tab-${d.dayKey}`}
                onClick={() => setDayKey(d.dayKey)}
                style={{
                  flexShrink: 0, padding: '6px 12px', borderRadius: '999px', cursor: 'pointer', fontSize: '12px',
                  border: `1px solid ${d.dayKey === dayKey ? PALETTE.gold : PALETTE.border}`,
                  background: d.dayKey === dayKey ? PALETTE.gold : 'transparent',
                  color: d.dayKey === dayKey ? '#fff' : PALETTE.text,
                }}
              >
                {formatDayTab(d.dayKey)}<span style={{ opacity: 0.7 }}> ({d.count})</span>
              </button>
            ))}
          </div>

          <div data-testid="angle-thumbs" style={{ display: 'flex', gap: '10px', overflowX: 'auto' }}>
            {dayPhotos.map(photo => {
              const isRef = photo.id === pair.reference.id
              const isCur = photo.id === pair.current.id
              const angle = angleOfBodyPart(photo.bodyPart)
              const thumb = thumbUrls[photo.id]
              return (
                <div key={photo.id} style={{ flexShrink: 0, width: '84px' }}>
                  <button
                    type="button"
                    data-testid={`thumb-${photo.id}`}
                    onClick={() => selectThumbnail(photo)}
                    aria-label={`${angleLabelOfPhoto(photo)}を${SIDE_LABEL[targetSide]}にセット`}
                    style={{
                      position: 'relative', display: 'block', width: '84px', height: '104px', padding: 0, overflow: 'hidden',
                      borderRadius: '10px', cursor: 'pointer', background: '#14100c',
                      border: `2px solid ${isRef || isCur ? PALETTE.gold : 'transparent'}`,
                    }}
                  >
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                    )}
                    {(isRef || isCur) && (
                      <span style={{
                        position: 'absolute', top: '4px', left: '4px', padding: '1px 6px', borderRadius: '6px',
                        background: PALETTE.gold, color: '#fff', fontSize: '10px', fontWeight: 700,
                      }}>
                        {isRef && isCur ? '左右' : isRef ? '左' : '右'}
                      </span>
                    )}
                  </button>
                  {angleEdit ? (
                    <select
                      aria-label="アングルを修正"
                      data-testid={`angle-select-${photo.id}`}
                      value={angle}
                      onChange={e => { void changeAngle(photo, e.target.value as PhotoAngle) }}
                      style={{ width: '100%', marginTop: '3px', fontSize: '11px', borderRadius: '6px', border: `1px solid ${PALETTE.border}` }}
                    >
                      {PHOTO_ANGLES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  ) : (
                    <p style={{ margin: '3px 0 0', textAlign: 'center', fontSize: '11px', color: PALETTE.text }}>
                      {angleLabelOfPhoto(photo)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          {angleError && <p style={{ margin: 0, fontSize: '11px', color: '#b3402e' }}>{angleError}</p>}
        </div>
      )}
    </div>
  )
}

const roundBtnStyle: React.CSSProperties = {
  width: '36px', height: '36px', borderRadius: '50%', border: `1px solid ${PALETTE.border}`,
  background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
}

function compareLabelStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', bottom: '14px', [side]: '14px',
    color: '#fff', fontSize: '13px', fontWeight: 700,
    textShadow: '0 1px 4px rgba(0,0,0,0.7)', pointerEvents: 'none',
  }
}

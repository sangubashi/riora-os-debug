'use client'
/**
 * PhotoCompareScreen.tsx — 写真カルテ Before/After比較UI(スライダー画面、2026-09-17)。
 *
 * デザイン確定(IMG_1453.JPG相当): ヘッダー(Salon Rioraテキストのみ・日付・
 * スライダー/並列切替・全画面トグル)＋中央の大きな写真比較エリア。
 *
 * 撮影用ゴーストUI(IpadPhotoCaptureModal.tsx、水平器・シャッター等)とは完全に別画面。
 * 対象は保存済み写真(既存の GET /api/customers/[id]/photos・signed-url API)のみで、
 * カメラ・アップロード・ゴースト・ジャイロには一切関与しない。メモ・AI・LINEも
 * 表示しない(閲覧専用の比較ビューアに徹する)。
 *
 * 初期ペア選定・日付候補一覧は src/lib/photos/comparePairSelection.ts の純粋関数
 * (既存のcomparisonSelection.tsのロジックをそのまま利用)に委譲する。
 * 連動ズーム・連動パンは src/hooks/useSyncedZoomPan.ts に委譲する(2枚の<img>へ
 * 同一のtransformを適用するだけの汎用フックで、写真固有の知識は持たない)。
 *
 * 権限: listCustomerPhotosTimeline/getBatchSignedUrls は既存の認証付きAPI
 * (authedFetch経由、サーバー側でcanAccessCustomer等の既存チェックを通る)をそのまま使う。
 * このコンポーネント自身は権限チェックを一切実装しない(=既存のチェックに委ねる)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Maximize2, Minimize2, MoveHorizontal, Rows3, SlidersHorizontal, X } from 'lucide-react'
import { listCustomerPhotosTimeline, getBatchSignedUrls, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import {
  pickInitialComparisonPair,
  listPhotoOptions,
  formatPhotoDateLabel,
  buildPhotoOptionLabels,
  type PhotoOption,
} from '@/lib/photos/comparePairSelection'
import type { ComparisonPair } from '@/lib/photos/comparisonSelection'
import { bodyPartLabel } from '@/lib/photos/bodyParts'
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

const imgBaseStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  willChange: 'transform', userSelect: 'none', pointerEvents: 'none',
}

export default function PhotoCompareScreen({ customerId, initialBodyPart, onClose }: Props) {
  const [photos, setPhotos] = useState<TimelinePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [pair, setPair] = useState<ComparisonPair | null>(null)
  const [urls, setUrls] = useState<{ reference?: string; current?: string }>({})

  const [viewMode, setViewMode] = useState<ViewMode>('slider')
  const [sliderPercent, setSliderPercent] = useState(50)
  const [fullscreen, setFullscreen] = useState(false)
  const [pickerSide, setPickerSide] = useState<PairSide | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const sliderAreaRef = useRef<HTMLDivElement | null>(null)
  const draggingHandleRef = useRef(false)
  const zoomPan = useSyncedZoomPan()

  // 顧客の全写真を1回だけ取得し、初期ペアを選ぶ(既存API・既存の認可チェックをそのまま利用)。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listCustomerPhotosTimeline(customerId).then(list => {
      if (cancelled) return
      setPhotos(list)
      setPair(pickInitialComparisonPair(list, initialBodyPart ?? null))
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  // ペアが変わるたびに署名URLを取得し直し、ズーム・スライダー位置をリセットする。
  useEffect(() => {
    if (!pair) { setUrls({}); return undefined }
    let cancelled = false
    getBatchSignedUrls(customerId, [pair.reference.id, pair.current.id], 'detail').then(map => {
      if (cancelled) return
      setUrls({ reference: map[pair.reference.id], current: map[pair.current.id] })
    })
    zoomPan.reset()
    setSliderPercent(50)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, pair?.reference.id, pair?.current.id])

  // ブラウザのFullscreen API(対応環境ではネイティブ全画面、非対応でもCSS側の全画面レイアウトは
  // 常に効くため見た目上は問題ない)。ユーザーがEsc等でネイティブ全画面を抜けた場合に同期する。
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

  // 個別写真単位の比較候補一覧(2026-09-17改訂: 撮影機会への丸め込みを行わないため、
  // 同一日・同一visitの複数枚もすべて独立した候補として並ぶ)。
  const photoOptions: PhotoOption[] = useMemo(
    () => (pair ? listPhotoOptions(photos, pair.bodyPart) : []),
    [photos, pair]
  )
  // 各候補の表示ラベル(同日・同時刻の写真も個別に識別できるよう、必要に応じて
  // 時刻・連番を付ける)。photoOptionsと同じ順序・同じ長さの配列。
  const photoOptionLabels = useMemo(() => buildPhotoOptionLabels(photoOptions), [photoOptions])

  const selectPhotoOption = (option: PhotoOption) => {
    if (!pair || !pickerSide) return
    setPair({ ...pair, [pickerSide]: option.photo })
    setPickerSide(null)
  }

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

  const referenceLabel = formatPhotoDateLabel(pair?.reference.takenAt ?? new Date().toISOString())
  const currentLabel = formatPhotoDateLabel(pair?.current.takenAt ?? new Date().toISOString())

  return (
    <div
      ref={rootRef}
      data-testid="photo-compare-screen"
      style={{
        position: 'fixed', inset: 0, zIndex: 450, background: PALETTE.bg,
        display: 'flex', flexDirection: 'column',
      }}
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
              <button
                type="button"
                onClick={() => setPickerSide(prev => (prev ? null : 'reference'))}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
                  borderRadius: '999px', border: `1px solid ${PALETTE.border}`, background: 'none', cursor: 'pointer',
                }}
              >
                <Calendar size={14} strokeWidth={1.8} color={PALETTE.gold} />
                <span style={{ fontSize: '12px', color: PALETTE.text }}>{referenceLabel.dateStr}</span>
                <span style={{ fontSize: '12px', color: PALETTE.muted }}>|</span>
                <span style={{ fontSize: '12px', color: PALETTE.text }}>{currentLabel.relative}</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {pair && (
              <p style={{ margin: 0, fontSize: '11px', color: PALETTE.muted }}>
                {bodyPartLabel(pair.bodyPart)}
              </p>
            )}
            <div style={{ display: 'flex', border: `1px solid ${PALETTE.border}`, borderRadius: '999px', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setViewMode('slider')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', border: 'none', cursor: 'pointer',
                  background: viewMode === 'slider' ? PALETTE.gold : 'transparent',
                  color: viewMode === 'slider' ? '#fff' : PALETTE.text, fontSize: '12px',
                }}
              >
                <SlidersHorizontal size={14} strokeWidth={1.8} />
                スライダー
              </button>
              <button
                type="button"
                onClick={() => setViewMode('sideBySide')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', border: 'none', cursor: 'pointer',
                  background: viewMode === 'sideBySide' ? PALETTE.gold : 'transparent',
                  color: viewMode === 'sideBySide' ? '#fff' : PALETTE.text, fontSize: '12px',
                }}
              >
                <Rows3 size={14} strokeWidth={1.8} style={{ transform: 'rotate(90deg)' }} />
                並列
              </button>
            </div>
            <button
              type="button"
              onClick={() => { void toggleFullscreen() }}
              aria-label="全画面表示切り替え"
              style={{
                width: '36px', height: '36px', borderRadius: '50%', border: `1px solid ${PALETTE.border}`,
                background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <Maximize2 size={15} strokeWidth={1.8} color={PALETTE.gold} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              style={{
                width: '36px', height: '36px', borderRadius: '50%', border: `1px solid ${PALETTE.border}`,
                background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <X size={16} strokeWidth={2} color={PALETTE.text} />
            </button>
          </div>
        </div>
      )}

      {/* 日付選択パネル(縦リスト、写真カルテ Phase 2のゴースト日付リストと同じ方針)。 */}
      {pickerSide && pair && (
        <div style={{
          position: 'absolute', top: fullscreen ? '16px' : '76px', left: '24px', zIndex: 10,
          background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '14px',
          boxShadow: PALETTE.shadow, padding: '12px', width: '260px', maxHeight: '320px', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <button
              type="button"
              onClick={() => setPickerSide('reference')}
              style={{
                flex: 1, padding: '6px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px',
                background: pickerSide === 'reference' ? PALETTE.gold : PALETTE.bg,
                color: pickerSide === 'reference' ? '#fff' : PALETTE.text,
              }}
            >
              前回(左)を選ぶ
            </button>
            <button
              type="button"
              onClick={() => setPickerSide('current')}
              style={{
                flex: 1, padding: '6px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px',
                background: pickerSide === 'current' ? PALETTE.gold : PALETTE.bg,
                color: pickerSide === 'current' ? '#fff' : PALETTE.text,
              }}
            >
              今回(右)を選ぶ
            </button>
          </div>
          {photoOptions.map((o, i) => {
            const isSelected = pickerSide === 'reference' ? o.photo.id === pair.reference.id : o.photo.id === pair.current.id
            return (
              <button
                key={o.photo.id}
                type="button"
                onClick={() => selectPhotoOption(o)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: '8px',
                  border: 'none', cursor: 'pointer', fontSize: '12px', marginBottom: '4px',
                  background: isSelected ? PALETTE.gold : 'transparent',
                  color: isSelected ? '#fff' : PALETTE.text,
                }}
              >
                {photoOptionLabels[i]}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#000' }}>
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
        ) : viewMode === 'slider' ? (
          <div
            ref={sliderAreaRef}
            {...zoomPan.handlers}
            style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
          >
            {urls.current && <img src={urls.current} alt="今回" style={{ ...imgBaseStyle, ...zoomPan.style }} />}
            {urls.reference && (
              <img
                src={urls.reference}
                alt="前回"
                style={{ ...imgBaseStyle, ...zoomPan.style, clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}
              />
            )}
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
            <span style={compareLabelStyle('left')}>前回</span>
            <span style={compareLabelStyle('right')}>今回</span>
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: '2px' }}>
            <div {...zoomPan.handlers} style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'none' }}>
              {urls.reference && <img src={urls.reference} alt="前回" style={{ ...imgBaseStyle, ...zoomPan.style }} />}
              <span style={compareLabelStyle('left')}>前回</span>
            </div>
            <div {...zoomPan.handlers} style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'none' }}>
              {urls.current && <img src={urls.current} alt="今回" style={{ ...imgBaseStyle, ...zoomPan.style }} />}
              <span style={compareLabelStyle('right')}>今回</span>
            </div>
          </div>
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
    </div>
  )
}

function compareLabelStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', bottom: '14px', [side]: '14px',
    color: '#fff', fontSize: '13px', fontWeight: 700,
    textShadow: '0 1px 4px rgba(0,0,0,0.7)', pointerEvents: 'none',
  }
}

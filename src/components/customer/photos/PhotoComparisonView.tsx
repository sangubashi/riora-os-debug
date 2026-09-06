'use client'
/**
 * PhotoComparisonView.tsx — 写真カルテ Phase4「Before/After左右比較(簡易版)」
 *
 * 設計方針:
 *   - スライダー比較・重ね比較・AI分析は今回のスコープ外(次フェーズ)。左右に並べて
 *     見比べるだけの最小実装。
 *   - 新規APIは作らず、既存の GET .../photos/[photoId]/signed-url(detail purpose)を
 *     2回呼ぶだけで済ませる(comparisonSelection.tsが選んだ2枚のIDのみを使う)。
 *   - 呼び出し元(PhotoTimelineView.tsx)がcomparableGroups()で「2枚以上あるbody_part」
 *     のみを対象にボタンを出すため、このコンポーネント自体は「写真が足りない」状態を
 *     受け取らない(pairは常に有効な2枚)。
 */
import { useEffect, useState } from 'react'
import { bodyPartLabel } from '@/lib/photos/bodyParts'
import type { ComparisonPair } from '@/lib/photos/comparisonSelection'
import { getPhotoSignedUrl, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { formatDateLabel } from '@/lib/photos/timelineGrouping'

interface Props {
  customerId: string
  pair:       ComparisonPair
  onClose:    () => void
}

interface SideState {
  url:     string | null
  loading: boolean
}

const IDLE_SIDE_STATE: SideState = { url: null, loading: true }

export default function PhotoComparisonView({ customerId, pair, onClose }: Props) {
  const [referenceState, setReferenceState] = useState<SideState>(IDLE_SIDE_STATE)
  const [currentState,   setCurrentState]   = useState<SideState>(IDLE_SIDE_STATE)
  const [enlargedUrl,    setEnlargedUrl]    = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReferenceState(IDLE_SIDE_STATE)
    setCurrentState(IDLE_SIDE_STATE)

    void getPhotoSignedUrl(customerId, pair.reference.id, 'detail').then(url => {
      if (!cancelled) setReferenceState({ url, loading: false })
    })
    void getPhotoSignedUrl(customerId, pair.current.id, 'detail').then(url => {
      if (!cancelled) setCurrentState({ url, loading: false })
    })

    return () => { cancelled = true }
  }, [customerId, pair.reference.id, pair.current.id])

  const referenceLabel = pair.basis === 'previous' ? '前回' : '初回'

  function renderSide(label: string, photo: TimelinePhoto, state: SideState) {
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#4878A8', marginBottom: '6px', textAlign: 'center' }}>
          {label}
        </p>
        <button
          type="button"
          onClick={() => state.url && setEnlargedUrl(state.url)}
          disabled={!state.url}
          style={{
            // 固定aspectRatio(1/1)+objectFit:'cover'は元画像をクロップしてしまう
            // (portrait写真の額・顎が切れる)ため廃止。minHeightは画像読込前の
            // プレースホルダー用の目安の高さで、画像自体を正方形に強制するものではない。
            minHeight: '160px', borderRadius: '14px', overflow: 'hidden', background: '#EEE',
            border: '1px solid #E4EEF8', padding: 0, cursor: state.url ? 'pointer' : 'default', width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {state.loading && (
            <div style={{
              padding: '40px 0', fontSize: '11px', color: '#8AAAC8',
            }}>
              読み込み中…
            </div>
          )}
          {!state.loading && state.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.url}
              alt=""
              style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block' }}
            />
          )}
          {!state.loading && !state.url && (
            <div style={{
              padding: '40px 0', fontSize: '11px', color: '#C05060',
            }}>
              表示できません
            </div>
          )}
        </button>
        <p style={{ fontSize: '10px', color: '#3d4858', marginTop: '6px', textAlign: 'center' }}>
          {formatDateLabel(photo.takenAt.slice(0, 10))}
        </p>
        {photo.menuName && (
          <p style={{ fontSize: '9px', color: '#8AAAC8', textAlign: 'center' }}>{photo.menuName}</p>
        )}
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 205, background: '#FAFCFF',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── ヘッダー ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'max(20px, calc(env(safe-area-inset-top) + 12px)) 16px 12px',
        borderBottom: '1px solid #E4EEF8', background: '#fff',
      }}>
        <div>
          <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#4878A8', fontWeight: 600 }}>
            ⇄ Before/After比較
          </p>
          <p style={{ fontSize: '11px', color: '#8AAAC8', marginTop: '2px' }}>
            {bodyPartLabel(pair.bodyPart)}(同じ部位)
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: '#F0F5FA', border: 'none', color: '#4878A8', fontSize: '16px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* ── 左右比較 ── */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px' }}>
        <div style={{
          display: 'flex', gap: '12px', maxWidth: 'var(--app-max-width, 430px)', margin: '0 auto',
          // alignItems:'flex-start'で片側だけstretchして余白が伸びるのを防ぐ
          // (portrait写真とlandscape写真が左右に並ぶと高さが変わるため)。
          alignItems: 'flex-start',
        }}>
          {renderSide(referenceLabel, pair.reference, referenceState)}
          {renderSide('今回', pair.current, currentState)}
        </div>
      </div>

      {/* ── 拡大表示(簡易ライトボックス) ── */}
      {enlargedUrl && (
        <div
          onClick={() => setEnlargedUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 215,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enlargedUrl}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px' }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setEnlargedUrl(null)}
            aria-label="閉じる"
            style={{
              position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', right: '20px',
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: '16px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

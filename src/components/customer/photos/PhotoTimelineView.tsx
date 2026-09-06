'use client'
/**
 * PhotoTimelineView.tsx — 写真カルテ Phase3「顧客ごとの写真時系列一覧」+
 *   Phase4「Before/After左右比較(ショートカット: 前回↔今回・初回↔今回)」の入口
 *
 * 設計方針:
 *   - 既存の GET /api/customers/[id]/photos・POST .../photos/signed-urls・
 *     GET .../photos/[photoId]/signed-url をそのまま利用する(新規API無し)。
 *     権限は各API側の extractStaffFromRequest + canAccessCustomer にそのまま委譲する。
 *   - 「撮影する」「写真を選択して追加」は既存のPhotoCaptureView/PhotoLibraryPickerViewを
 *     そのまま使う。この画面はそれらを起動するトリガー(onOpenCapture/onOpenLibraryPicker)を
 *     呼ぶだけで、カメラ・アップロードのロジックには一切触れない。
 *   - 比較は「同一body_part内で前回↔今回・初回↔今回」のショートカットのみ(任意の2枚選択は
 *     未実装)。実際の左右表示はPhotoComparisonView.tsxに委譲する。
 *   - スライダー比較・重ね比較・撮影ガイド改修・AI分析は今回のスコープ外(次フェーズ)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { bodyPartLabel } from '@/lib/photos/bodyParts'
import {
  buildFirstComparison,
  buildPreviousComparison,
  comparableGroups,
  groupPhotosByBodyPart,
  type ComparisonPair,
} from '@/lib/photos/comparisonSelection'
import { getBatchSignedUrls, getPhotoSignedUrl, listCustomerPhotosTimeline, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { formatDateLabel, groupPhotosByDate } from '@/lib/photos/timelineGrouping'
import PhotoComparisonView from './PhotoComparisonView'

interface Props {
  customerId:          string
  /** 撮影/ライブラリ追加が完了して閉じるたびに親側でインクリメントし、一覧を再取得させる。 */
  refreshKey:          number
  onClose:             () => void
  onOpenCapture:       () => void
  onOpenLibraryPicker: () => void
}

type LoadState = 'loading' | 'ready' | 'error'

export default function PhotoTimelineView({
  customerId, refreshKey, onClose, onOpenCapture, onOpenLibraryPicker,
}: Props) {
  const [photos, setPhotos]           = useState<TimelinePhoto[]>([])
  const [thumbUrls, setThumbUrls]     = useState<Record<string, string>>({})
  const [loadState, setLoadState]     = useState<LoadState>('loading')
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxLoading, setLightboxLoading] = useState(false)
  const [comparisonPair, setComparisonPair] = useState<ComparisonPair | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')

    void (async () => {
      try {
        const list = await listCustomerPhotosTimeline(customerId)
        if (cancelled) return
        setPhotos(list)

        const urls = await getBatchSignedUrls(customerId, list.map(p => p.id), 'thumbnail')
        if (cancelled) return
        setThumbUrls(urls)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    })()

    return () => { cancelled = true }
  }, [customerId, refreshKey])

  const groups = useMemo(() => groupPhotosByDate(photos), [photos])
  const comparisonGroups = useMemo(
    () => comparableGroups(groupPhotosByBodyPart(photos)),
    [photos]
  )

  const openLightbox = useCallback((photoId: string) => {
    setLightboxPhotoId(photoId)
    setLightboxUrl(null)
    setLightboxLoading(true)
    void getPhotoSignedUrl(customerId, photoId, 'detail').then(url => {
      setLightboxUrl(url)
      setLightboxLoading(false)
    })
  }, [customerId])

  const closeLightbox = useCallback(() => {
    setLightboxPhotoId(null)
    setLightboxUrl(null)
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(30, 30, 40, 0.5)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 'var(--app-max-width, 430px)',
          height: '100%',
          margin: '0 auto',
          background: '#FAFCFF',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── ヘッダー ── */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 12px)) 16px 12px',
          borderBottom: '1px solid #E4EEF8', background: '#fff',
        }}>
          <div>
            <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#4878A8', fontWeight: 600 }}>
              📷 写真カルテ
            </p>
            <p style={{ fontSize: '11px', color: '#8AAAC8', marginTop: '2px' }}>
              {loadState === 'ready' ? `${photos.length}枚` : ''}
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

        {/* ── 撮影・追加アクション ── */}
        <div style={{ flexShrink: 0, display: 'flex', gap: '8px', padding: '10px 16px 0' }}>
          <button
            type="button"
            onClick={onOpenCapture}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '13px', borderRadius: '16px', background: '#fff', border: '1px solid #C8DCF0',
              color: '#4878A8', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            📷 撮影する
          </button>
          <button
            type="button"
            onClick={onOpenLibraryPicker}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '13px', borderRadius: '16px', background: '#fff', border: '1px solid #C8DCF0',
              color: '#4878A8', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            🖼 選択して追加
          </button>
        </div>

        {/* ── Before/After比較(同一部位の前回↔今回・初回↔今回ショートカット) ── */}
        {loadState === 'ready' && (
          <div style={{ flexShrink: 0, padding: '12px 16px 0' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: '#3d4858', marginBottom: '8px' }}>
              ⇄ Before/After比較
            </p>
            {comparisonGroups.length === 0 ? (
              <p style={{ fontSize: '11px', color: '#8AAAC8', lineHeight: 1.6 }}>
                比較できる写真がありません（同じ部位の写真が2枚以上必要です）
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {comparisonGroups.map(group => (
                  <div
                    key={group.bodyPart}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                      background: '#fff', border: '1px solid #E4EEF8', borderRadius: '12px', padding: '8px 10px',
                    }}
                  >
                    <span style={{
                      fontSize: '12px', fontWeight: 600, color: '#3d4858',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {bodyPartLabel(group.bodyPart)}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => setComparisonPair(buildPreviousComparison(group))}
                        style={{
                          padding: '6px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                          background: '#F0F5FA', border: '1px solid #C8DCF0', color: '#4878A8', cursor: 'pointer',
                        }}
                      >
                        前回↔今回
                      </button>
                      {group.photos.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setComparisonPair(buildFirstComparison(group))}
                          style={{
                            padding: '6px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                            background: '#F0F5FA', border: '1px solid #C8DCF0', color: '#4878A8', cursor: 'pointer',
                          }}
                        >
                          初回↔今回
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 一覧(スクロール領域) ── */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 16px 24px' }}>
          {loadState === 'loading' && (
            <p style={{ textAlign: 'center', fontSize: '12px', color: '#8AAAC8', padding: '32px 0' }}>
              読み込み中…
            </p>
          )}
          {loadState === 'error' && (
            <p style={{ textAlign: 'center', fontSize: '12px', color: '#C05060', padding: '32px 0' }}>
              写真の読み込みに失敗しました
            </p>
          )}
          {loadState === 'ready' && groups.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: '#8AAAC8' }}>
              <p style={{ fontSize: '28px', marginBottom: '8px' }}>📷</p>
              <p style={{ fontSize: '12px', lineHeight: 1.7 }}>
                まだ写真がありません。<br />
                「撮影する」または「選択して追加」から登録できます。
              </p>
            </div>
          )}
          {loadState === 'ready' && groups.map(group => (
            <div key={group.dateKey} style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#3d4858', marginBottom: '8px' }}>
                {formatDateLabel(group.dateKey)}
              </p>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '10px',
              }}>
                {group.photos.map(photo => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => openLightbox(photo.id)}
                    style={{
                      background: '#fff', borderRadius: '14px', overflow: 'hidden',
                      border: '1px solid #E4EEF8', padding: 0, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', textAlign: 'left',
                    }}
                  >
                    <div style={{ aspectRatio: '1 / 1', background: '#EEE' }}>
                      {thumbUrls[photo.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrls[photo.id]}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#C8DCF0',
                        }}>
                          🖼
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '6px 8px' }}>
                      <p style={{
                        fontSize: '10px', fontWeight: 600, color: '#3d4858',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {bodyPartLabel(photo.bodyPart)}
                      </p>
                      {photo.menuName && (
                        <p style={{
                          fontSize: '9px', color: '#8AAAC8', marginTop: '1px',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {photo.menuName}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 拡大表示(簡易ライトボックス) ── */}
      {lightboxPhotoId && (
        <div
          onClick={closeLightbox}
          style={{
            position: 'fixed', inset: 0, zIndex: 210,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          {lightboxLoading && (
            <p style={{ color: '#fff', fontSize: '13px' }}>読み込み中…</p>
          )}
          {!lightboxLoading && lightboxUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightboxUrl}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px' }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {!lightboxLoading && !lightboxUrl && (
            <p style={{ color: '#fff', fontSize: '13px' }}>画像を表示できませんでした</p>
          )}
          <button
            type="button"
            onClick={closeLightbox}
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

      {/* ── Before/After左右比較 ── */}
      {comparisonPair && (
        <PhotoComparisonView
          customerId={customerId}
          pair={comparisonPair}
          onClose={() => setComparisonPair(null)}
        />
      )}
    </div>
  )
}

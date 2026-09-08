'use client'
/**
 * PhotoTimelineView.tsx — 写真カルテ Phase3「顧客ごとの写真時系列一覧」+
 *   Phase4「Before/After左右比較(ショートカット: 前回↔今回・初回↔今回)」+
 *   Phase5「拡大表示からの削除(誤タップ防止のため確認ステップあり)」の入口
 *
 * 設計方針:
 *   - 既存の GET /api/customers/[id]/photos・POST .../photos/signed-urls・
 *     GET .../photos/[photoId]/signed-url・DELETE .../photos/[photoId] をそのまま利用する
 *     (新規API無し)。権限は各API側の extractStaffFromRequest + canAccessCustomer に
 *     そのまま委譲する。
 *   - 「撮影する」「写真を選択して追加」は既存のPhotoCaptureView/PhotoLibraryPickerViewを
 *     そのまま使う。この画面はそれらを起動するトリガー(onOpenCapture/onOpenLibraryPicker)を
 *     呼ぶだけで、カメラ・アップロードのロジックには一切触れない。
 *   - 比較は「同一body_part内で前回↔今回・初回↔今回」のショートカットのみ(任意の2枚選択は
 *     未実装)。実際の左右表示はPhotoComparisonView.tsxに委譲する。
 *   - 削除はPhase1設計どおり論理削除のみ(deleted_at更新、Storage実ファイルは削除しない。
 *     ユーザー確定 2026-09-06)。拡大表示(ライトボックス)の中に削除導線を置き、誤タップ防止の
 *     ため「本当に削除しますか？」の確認ステップを挟む。
 *   - スライダー比較・重ね比較・撮影ガイド改修・AI分析は今回のスコープ外(次フェーズ)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { bodyPartLabel } from '@/lib/photos/bodyParts'
import {
  buildFirstComparison,
  buildPreviousComparison,
  comparableGroups,
  groupPhotosByBodyPart,
  hasDistinctFirstOccasion,
  type ComparisonPair,
} from '@/lib/photos/comparisonSelection'
import {
  deletePhoto,
  getBatchSignedUrls,
  getPhotoSignedUrl,
  listCustomerPhotosTimeline,
  type TimelinePhoto,
} from '@/lib/photos/photoApiClient'
import { buildVisitTabs, formatDateLabel, groupPhotosByDate } from '@/lib/photos/timelineGrouping'
import PhotoComparisonView from './PhotoComparisonView'

/**
 * 写真カルテ Phase2「角度フィルター」の固定選択肢。既存のbody_part語彙
 * (face_front/face_left45/face_right45、src/lib/photos/bodyParts.ts)をそのまま使う
 * (新しいangleカラムは追加しない)。表示はこのフィルター専用の短いラベルにする
 * (BODY_PART_OPTIONSの「顔全体・正面」等は撮影画面向けの長いラベルのため流用しない)。
 */
const ANGLE_FILTER_OPTIONS: { id: string; label: string }[] = [
  { id: 'face_front',   label: '正面' },
  { id: 'face_left45',  label: '左45°' },
  { id: 'face_right45', label: '右45°' },
]

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
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // 写真カルテ Phase2「来店回数タイムライン」: 一覧表示のみを絞り込むフィルター状態。
  // null = 「すべて」(既存の日付タイムライン表示を維持)。比較ショートカット
  // (comparisonPair/comparableGroups等)には一切影響させない(常に全写真セットが対象)。
  const [selectedVisitId,   setSelectedVisitId]   = useState<string | null>(null)
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null)

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

  // 写真カルテ Phase2: 来店タブは「visit_id/visitCountAtが両方揃っている写真」のみから
  // 実データに存在する回数だけ組み立てる(欠番を埋めない、buildVisitTabs参照)。
  const visitTabs = useMemo(() => buildVisitTabs(photos), [photos])

  // 選択中の来店/角度で一覧表示のみを絞り込む(比較ショートカットには使わない)。
  const displayedPhotos = useMemo(() => {
    let result = photos
    if (selectedVisitId)  result = result.filter(p => p.visitId === selectedVisitId)
    if (selectedBodyPart) result = result.filter(p => p.bodyPart === selectedBodyPart)
    return result
  }, [photos, selectedVisitId, selectedBodyPart])

  const groups = useMemo(() => groupPhotosByDate(displayedPhotos), [displayedPhotos])

  // Before/After比較(前回↔今回・初回↔今回)は来店/角度フィルターと無関係に、
  // 常に全写真セット(photos)を対象とする(既存仕様を維持、絞り込みの影響を受けない)。
  const comparisonGroups = useMemo(
    () => comparableGroups(groupPhotosByBodyPart(photos)),
    [photos]
  )

  const openLightbox = useCallback((photoId: string) => {
    setLightboxPhotoId(photoId)
    setLightboxUrl(null)
    setLightboxLoading(true)
    setDeleteConfirming(false)
    setDeleteError(null)
    void getPhotoSignedUrl(customerId, photoId, 'detail').then(url => {
      setLightboxUrl(url)
      setLightboxLoading(false)
    })
  }, [customerId])

  const closeLightbox = useCallback(() => {
    setLightboxPhotoId(null)
    setLightboxUrl(null)
    setDeleteConfirming(false)
    setDeleteError(null)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!lightboxPhotoId) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deletePhoto(customerId, lightboxPhotoId)
      setPhotos(prev => prev.filter(p => p.id !== lightboxPhotoId))
      closeLightbox()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'delete_failed')
      setDeleteConfirming(false)
    } finally {
      setDeleting(false)
    }
  }, [customerId, lightboxPhotoId, closeLightbox])

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
                      {hasDistinctFirstOccasion(group) && (
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

        {/* ── 写真カルテ Phase2: 来店回数タブ(横スクロール・一覧表示のみを絞り込む) ──
              画面幅に合わせた折り返しはしない(overflowX:'auto' + 各ボタンflexShrink:0で
              PhotoCaptureView.tsxの部位選択チップと同じ横スクロールパターンを踏襲)。
              visit_id/visitCountAtが無い写真(未紐付け写真)はここには現れない
              (「すべて」選択時のみ、既存の日付タイムラインにこれまで通り表示される)。 */}
        {loadState === 'ready' && visitTabs.length > 0 && (
          <div style={{ flexShrink: 0, padding: '12px 16px 0' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: '#3d4858', marginBottom: '8px' }}>
              📅 来店で絞り込み
            </p>
            <div style={{
              display: 'flex', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              paddingBottom: '2px',
            }}>
              <button
                type="button"
                onClick={() => setSelectedVisitId(null)}
                style={{
                  flexShrink: 0, padding: '7px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                  border:     selectedVisitId === null ? 'none' : '1px solid #C8DCF0',
                  background: selectedVisitId === null ? '#4878A8' : '#fff',
                  color:      selectedVisitId === null ? '#fff' : '#4878A8',
                }}
              >
                すべて
              </button>
              {visitTabs.map(tab => (
                <button
                  key={tab.visitId}
                  type="button"
                  onClick={() => setSelectedVisitId(tab.visitId)}
                  style={{
                    flexShrink: 0, padding: '7px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                    whiteSpace: 'nowrap', cursor: 'pointer',
                    border:     selectedVisitId === tab.visitId ? 'none' : '1px solid #C8DCF0',
                    background: selectedVisitId === tab.visitId ? '#4878A8' : '#fff',
                    color:      selectedVisitId === tab.visitId ? '#fff' : '#4878A8',
                  }}
                >
                  {tab.visitCountAt === 1 ? '初回' : `${tab.visitCountAt}回目`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 写真カルテ Phase2: 角度フィルター(横スクロール・一覧表示のみを絞り込む) ──
              既存のbody_part(face_front/face_left45/face_right45)をそのまま使う。 */}
        {loadState === 'ready' && photos.length > 0 && (
          <div style={{ flexShrink: 0, padding: '10px 16px 0' }}>
            <div style={{
              display: 'flex', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              paddingBottom: '2px',
            }}>
              <button
                type="button"
                onClick={() => setSelectedBodyPart(null)}
                style={{
                  flexShrink: 0, padding: '7px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                  border:     selectedBodyPart === null ? 'none' : '1px solid #C8DCF0',
                  background: selectedBodyPart === null ? '#4878A8' : '#fff',
                  color:      selectedBodyPart === null ? '#fff' : '#4878A8',
                }}
              >
                すべての角度
              </button>
              {ANGLE_FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedBodyPart(opt.id)}
                  style={{
                    flexShrink: 0, padding: '7px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                    whiteSpace: 'nowrap', cursor: 'pointer',
                    border:     selectedBodyPart === opt.id ? 'none' : '1px solid #C8DCF0',
                    background: selectedBodyPart === opt.id ? '#4878A8' : '#fff',
                    color:      selectedBodyPart === opt.id ? '#fff' : '#4878A8',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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
          {loadState === 'ready' && groups.length === 0 && photos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: '#8AAAC8' }}>
              <p style={{ fontSize: '28px', marginBottom: '8px' }}>📷</p>
              <p style={{ fontSize: '12px', lineHeight: 1.7 }}>
                まだ写真がありません。<br />
                「撮影する」または「選択して追加」から登録できます。
              </p>
            </div>
          )}
          {/* 写真カルテ Phase2: 写真自体はあるが、来店/角度フィルターの結果が0件のケース。
              上の「まだ写真がありません」(=写真自体が無い)とは文言を分ける。 */}
          {loadState === 'ready' && groups.length === 0 && photos.length > 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: '#8AAAC8' }}>
              <p style={{ fontSize: '12px', lineHeight: 1.7 }}>
                選択した条件に一致する写真がありません。
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

      {/* ── 拡大表示(簡易ライトボックス)。誤タップしにくいよう削除導線もここに置く ── */}
      {lightboxPhotoId && (
        <div
          onClick={deleting ? undefined : closeLightbox}
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
            onClick={deleting ? undefined : closeLightbox}
            disabled={deleting}
            aria-label="閉じる"
            style={{
              position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', right: '20px',
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: '16px',
              cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>

          {/* 削除導線。誤タップ防止のため確認ステップを挟む(即削除しない)。
              下部の状態(通常/確認中/エラー)は排他なので1つのコンテナにまとめ重なりを防ぐ。 */}
          {!lightboxLoading && lightboxUrl && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', bottom: 'max(24px, env(safe-area-inset-bottom))',
                left: '24px', right: '24px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '8px',
              }}
            >
              {deleteError && !deleteConfirming && (
                <p style={{
                  fontSize: '11px', color: '#FFB4C0', background: 'rgba(0,0,0,0.5)',
                  padding: '6px 12px', borderRadius: '999px', margin: 0,
                }}>
                  削除に失敗しました（{deleteError}）
                </p>
              )}

              {!deleteConfirming && (
                <button
                  type="button"
                  onClick={() => { setDeleteConfirming(true); setDeleteError(null) }}
                  style={{
                    padding: '10px 20px', borderRadius: '999px',
                    background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  🗑 削除
                </button>
              )}

              {deleteConfirming && (
                <div style={{
                  width: '100%', maxWidth: '340px', background: '#fff', borderRadius: '16px', padding: '16px',
                  display: 'flex', flexDirection: 'column', gap: '10px',
                }}>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#3d4858', textAlign: 'center', margin: 0 }}>
                    本当に削除しますか？
                  </p>
                  <p style={{ fontSize: '11px', color: '#8AAAC8', textAlign: 'center', margin: 0 }}>
                    この操作は取り消せません
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirming(false)}
                      disabled={deleting}
                      style={{
                        flex: 1, padding: '11px', borderRadius: '999px', fontSize: '13px', fontWeight: 600,
                        background: '#fff', color: '#688098', border: '1.5px solid #C8DCF0',
                        cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.5 : 1,
                      }}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmDelete()}
                      disabled={deleting}
                      style={{
                        flex: 1, padding: '11px', borderRadius: '999px', fontSize: '13px', fontWeight: 700,
                        background: '#C05060', color: '#fff', border: 'none',
                        cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1,
                      }}
                    >
                      {deleting ? '削除中…' : '削除する'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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

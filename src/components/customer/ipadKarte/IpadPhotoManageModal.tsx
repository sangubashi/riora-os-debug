'use client'
/**
 * IpadPhotoManageModal.tsx — iPadスタッフカルテ「写真カルテ」セクションの
 * 「🗑 写真を削除」モーダル(PHASE IPAD-PHOTO-CAPTURE-2・2026-09-15)。
 *
 * 顧客の全写真(過去分含む)をサムネイル一覧で表示し、個別にソフトデリートする。
 * 一覧取得(listCustomerPhotosTimeline)・signed URL取得(getBatchSignedUrls)・
 * 削除(deletePhoto→既存のDELETE /api/customers/[id]/photos/[photoId]、所有権チェック済み・
 * ソフトデリート実装済み)はいずれも既存のphotoApiClient.tsをそのまま利用する
 * (新規API・DB変更は無し)。
 *
 * 部位ラベルの表示には bodyParts.ts の bodyPartLabel() を使う。IPAD_KARTE_ANGLES
 * (タブに出す現行4語彙)に無いレガシー値(face_oblique/chin/face_left45等)でも
 * 人が読めるラベルへ解決できる(タブに縛られず任意のbody_part値を一覧表示する用途のため)。
 *
 * 既存のPhotoPanel(表示・比較用、PhotoCompareKit.tsx)には一切手を加えず、独立した
 * 削除フローとして実装する(IpadPhotoCaptureModal.tsxと同じ方針)。
 */
import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { listCustomerPhotosTimeline, getBatchSignedUrls, deletePhoto, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { bodyPartLabel } from '@/lib/photos/bodyParts'
import { PALETTE, headingFont, formatVisitDateLabel } from '@/components/customer/shared/PhotoCompareKit'

interface Props {
  customerId: string
  onClose: () => void
  /** 1件削除成功のたびに呼ぶ(親側でIpadKarteDataのrefetchPhotosを呼ぶ想定)。モーダルは閉じない。 */
  onDeleted: () => void
}

export default function IpadPhotoManageModal({ customerId, onClose, onDeleted }: Props) {
  const [photos, setPhotos] = useState<TimelinePhoto[] | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await listCustomerPhotosTimeline(customerId)
      if (cancelled) return
      setPhotos(list)
      const urls = await getBatchSignedUrls(customerId, list.map(p => p.id), 'thumbnail')
      if (cancelled) return
      setPhotoUrls(urls)
    })()
    return () => { cancelled = true }
  }, [customerId])

  const handleConfirmDelete = async (photoId: string) => {
    setDeletingId(photoId)
    setDeleteError(null)
    try {
      await deletePhoto(customerId, photoId)
      setPhotos(prev => (prev ? prev.filter(p => p.id !== photoId) : prev))
      setConfirmingId(null)
      onDeleted()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'delete_failed')
    } finally {
      setDeletingId(null)
    }
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
          background: PALETTE.bg, borderRadius: '16px', width: '100%', maxWidth: '640px',
          maxHeight: '88vh', overflowY: 'auto', padding: '24px',
          display: 'flex', flexDirection: 'column', gap: '16px',
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
            写真を削除
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted, padding: '4px' }}
          >
            <X size={22} strokeWidth={2} />
          </button>
        </div>

        {photos === null ? (
          <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted, textAlign: 'center', padding: '24px 0' }}>
            読み込み中…
          </p>
        ) : photos.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted, textAlign: 'center', padding: '24px 0' }}>
            登録されている写真はまだありません。
          </p>
        ) : (
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px',
            }}
          >
            {photos.map(photo => {
              const isConfirming = confirmingId === photo.id
              const isDeleting = deletingId === photo.id
              return (
                <div key={photo.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div
                    style={{
                      position: 'relative', aspectRatio: '1 / 1', borderRadius: '10px',
                      overflow: 'hidden', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
                    }}
                  >
                    {photoUrls[photo.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrls[photo.id]}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%' }} />
                    )}

                    {!isConfirming && (
                      <button
                        type="button"
                        onClick={() => { setDeleteError(null); setConfirmingId(photo.id) }}
                        aria-label="この写真を削除"
                        style={{
                          position: 'absolute', top: '6px', right: '6px', width: '30px', height: '30px',
                          borderRadius: '50%', border: 'none', background: 'rgba(20,16,12,0.65)',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={15} strokeWidth={1.8} />
                      </button>
                    )}

                    {isConfirming && (
                      <div
                        style={{
                          position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.85)',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          gap: '8px', padding: '8px', textAlign: 'center',
                        }}
                      >
                        <p style={{ margin: 0, fontSize: '11px', color: '#fff', lineHeight: 1.5 }}>
                          この写真を削除しますか？
                        </p>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            disabled={isDeleting}
                            style={{
                              padding: '5px 10px', borderRadius: '6px', fontSize: '11px',
                              border: '1px solid rgba(255,255,255,0.5)', background: 'none', color: '#fff',
                              cursor: isDeleting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            キャンセル
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleConfirmDelete(photo.id) }}
                            disabled={isDeleting}
                            style={{
                              padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                              border: 'none', background: '#c0392b', color: '#fff',
                              cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.7 : 1,
                            }}
                          >
                            {isDeleting ? '削除中…' : '削除する'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: PALETTE.text, lineHeight: 1.4 }}>
                    {bodyPartLabel(photo.bodyPart)}
                  </p>
                  <p style={{ margin: 0, fontSize: '10px', color: PALETTE.muted }}>
                    {formatVisitDateLabel(photo.takenAt) ?? ''}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {deleteError && (
          <p style={{ margin: 0, fontSize: '12px', color: '#c0392b', textAlign: 'center' }}>
            削除に失敗しました: {deleteError}
          </p>
        )}
      </div>
    </div>
  )
}

'use client'
/**
 * PhotoDayPicker.tsx — お客様カルテ(メイン画面)の「撮影日付ボタン → アングル一覧」(2026-10-02)。
 *
 * 大きな比較写真エリアの直下に置く。撮影日ごとのボタンを並べ、タップするとその日に
 * 撮影された写真(正面・右斜め・左斜め・額…)が直下にズラッと並んで展開される。
 * サムネイルのタップで、左(前)/右(後)のどちらか(「左に出す/右に出す」切替)の
 * 比較写真として選択する。選択の反映は呼び出し元(onPick)が担当する。
 *
 * 日付・アングルの導出は src/lib/photos/photoAngle.ts の純粋関数を使う。
 * サムネイルURLは自前で取得・キャッシュする(getBatchSignedUrls、展開した日の分のみ)。
 * 権限チェックは既存API(authedFetch経由)に委ねる。
 */
import { useEffect, useMemo, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { getBatchSignedUrls, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { angleLabelOfPhoto, listPhotoDays, listPhotosOfDay } from '@/lib/photos/photoAngle'
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'

export type PickSide = 'left' | 'right'

interface Props {
  customerId: string
  photos: TimelinePhoto[]
  /** 現在、左・右に表示中の写真ID(サムネイルに「左」「右」の印を付ける)。 */
  leftPhotoId: string | null
  rightPhotoId: string | null
  /** 既に取得済みのURL(あれば再取得しない)。 */
  knownUrls?: Record<string, string>
  onPick: (photo: TimelinePhoto, side: PickSide) => void
}

export default function PhotoDayPicker({ customerId, photos, leftPhotoId, rightPhotoId, knownUrls, onPick }: Props) {
  const days = useMemo(() => listPhotoDays(photos), [photos])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [side, setSide] = useState<PickSide>('right')
  const [urls, setUrls] = useState<Record<string, string>>({})

  const dayPhotos = useMemo(() => (openDay ? listPhotosOfDay(photos, openDay) : []), [photos, openDay])

  useEffect(() => {
    const missing = dayPhotos.map(p => p.id).filter(id => !urls[id] && !knownUrls?.[id])
    if (missing.length === 0) return undefined
    let cancelled = false
    getBatchSignedUrls(customerId, missing, 'thumbnail')
      .then(map => { if (!cancelled) setUrls(prev => ({ ...prev, ...map })) })
      .catch(() => { /* サムネイルが出ないだけで選択は可能 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, dayPhotos])

  if (days.length === 0) return null

  return (
    <div data-testid="photo-day-picker" style={{ marginTop: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <p style={{ margin: 0, fontSize: '12px', letterSpacing: '0.06em', color: PALETTE.muted, flexShrink: 0 }}>撮影日</p>
        <div data-testid="day-buttons" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {days.map(d => {
            const active = d.dayKey === openDay
            return (
              <button
                key={d.dayKey}
                type="button"
                data-testid={`day-btn-${d.dayKey}`}
                aria-expanded={active}
                onClick={() => setOpenDay(active ? null : d.dayKey)}
                style={{
                  padding: '8px 14px', borderRadius: '999px', cursor: 'pointer', fontSize: '13px',
                  border: `1px solid ${active ? PALETTE.gold : PALETTE.border}`,
                  background: active ? PALETTE.gold : 'none', color: active ? '#fff' : PALETTE.text,
                }}
              >
                {d.dayKey.replace(/-/g, '/')}
                <span style={{ opacity: 0.7, fontSize: '11px' }}> ({d.count}枚)</span>
              </button>
            )
          })}
        </div>
      </div>

      {openDay && (
        <div
          data-testid="day-angle-list"
          style={{
            background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '14px',
            padding: '12px', boxShadow: PALETTE.shadow,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: `1px solid ${PALETTE.border}`, borderRadius: '999px', overflow: 'hidden' }}>
              {(['left', 'right'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  data-testid={`pick-side-${s}`}
                  onClick={() => setSide(s)}
                  style={{
                    padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '12px',
                    background: side === s ? PALETTE.gold : 'transparent', color: side === s ? '#fff' : PALETTE.text,
                  }}
                >
                  {s === 'left' ? '左に出す' : '右に出す'}
                </button>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: PALETTE.muted }}>見たい角度をタップしてください</p>
          </div>

          <div data-testid="day-thumb-row" style={{ display: 'flex', gap: '8px' }}>
            {dayPhotos.map(photo => {
              const url = knownUrls?.[photo.id] ?? urls[photo.id]
              const mark = photo.id === leftPhotoId && photo.id === rightPhotoId ? '左右'
                : photo.id === leftPhotoId ? '左' : photo.id === rightPhotoId ? '右' : null
              return (
                <button
                  key={photo.id}
                  type="button"
                  data-testid={`day-thumb-${photo.id}`}
                  onClick={() => onPick(photo, side)}
                  aria-label={`${angleLabelOfPhoto(photo)}を${side === 'left' ? '左' : '右'}に表示`}
                  style={{ flex: '1 1 0', minWidth: 0, maxWidth: '160px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <span
                    style={{
                      position: 'relative', display: 'block', width: '100%', aspectRatio: '4 / 5', overflow: 'hidden',
                      borderRadius: '10px', background: '#EFE8DA',
                      border: mark ? `2px solid ${PALETTE.gold}` : `1px solid ${PALETTE.border}`,
                    }}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <ImageOff size={16} strokeWidth={1.3} color={PALETTE.gold} />
                      </span>
                    )}
                    {mark && (
                      <span style={{
                        position: 'absolute', top: '4px', left: '4px', padding: '1px 7px', borderRadius: '6px',
                        background: PALETTE.gold, color: '#fff', fontSize: '10px', fontWeight: 700,
                      }}>
                        {mark}
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', marginTop: '4px', textAlign: 'center', fontSize: '12px', color: PALETTE.text }}>
                    {angleLabelOfPhoto(photo)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

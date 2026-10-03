'use client'
/**
 * PhotoDateHistory.tsx — お客様カルテ「過去の写真」(撮影日チップ → その日の写真を全部表示)。
 *
 * - 撮影日(taken_at・JST暦日)ごとの日付チップを新しい順に横並びで表示し、初期選択は最新の撮影日。
 * - 選択した日の写真を、角度順(同角度内は撮影時刻の古い順)で横スクロール1列に表示する。
 *   同日同角度の複数枚も統合・代表写真化せず1枚ずつ全て出す。旧データ(face_left45等)も除外しない。
 * - 写真タップは親(CustomerModeView)の既存ライトボックスを開く(onOpenPhoto)。
 * - サムネイルURLは既存の getBatchSignedUrls('thumbnail') を、選択した日の分だけ取得する。
 * 写真比較(PhotoCompareScreen・useSyncedZoomPan・useIndependentZoomPan)・自由選択比較・
 * 既存の同日ギャラリー(openSameDayGallery)には触れない。
 */
import { useEffect, useMemo, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { getBatchSignedUrls, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { BATCH_SIGNED_URL_MAX_IDS } from '@/lib/photos/constants'
import { bodyPartLabel } from '@/lib/photos/bodyParts'
import {
  currentJstYear,
  formatDateChipLabel,
  formatJstTime,
  groupPhotosByJstDate,
} from '@/lib/photos/groupPhotosByJstDate'
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'

/**
 * この画面専用の旧データ表示名。既存の bodyPartLabel() は face_left45/face_right45 を
 * 左右の区別なく「斜め」と表示するため、ここでだけ「右斜め」「左斜め」にする。
 * それ以外は bodyPartLabel() のまま(未定義の値はその文字列を表示)。他画面の表示名・DBの値は変更しない。
 */
const LEGACY_LABEL_OVERRIDES: Record<string, string> = {
  face_right45: '右斜め',
  face_left45: '左斜め',
}

function photoAngleLabel(bodyPart: string): string {
  return LEGACY_LABEL_OVERRIDES[bodyPart] ?? bodyPartLabel(bodyPart)
}

interface Props {
  customerId: string
  photos: TimelinePhoto[]
  /** 既に取得済みのURL(比較パネル用の事前取得分)。あれば再取得しない。 */
  knownUrls: Record<string, string>
  onOpenPhoto: (photo: TimelinePhoto) => void
}

export default function PhotoDateHistory({ customerId, photos, knownUrls, onOpenPhoto }: Props) {
  const groups = useMemo(() => groupPhotosByJstDate(photos), [photos])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})

  // 選択が無い・消えた(写真削除等)場合は最新の撮影日を選ぶ。
  const activeKey = groups.some(g => g.dateKey === selectedKey) ? selectedKey : (groups[0]?.dateKey ?? null)
  const activeGroup = groups.find(g => g.dateKey === activeKey) ?? null
  const year = currentJstYear()

  // 選択中の日の写真だけサムネイルURLを取得する(取得済み分は再取得しない)。
  useEffect(() => {
    if (!activeGroup) return
    const missing = activeGroup.photos.map(p => p.id).filter(id => !knownUrls[id] && !thumbUrls[id])
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const merged: Record<string, string> = {}
      for (let i = 0; i < missing.length; i += BATCH_SIGNED_URL_MAX_IDS) {
        const urls = await getBatchSignedUrls(customerId, missing.slice(i, i + BATCH_SIGNED_URL_MAX_IDS), 'thumbnail')
        Object.assign(merged, urls)
      }
      if (!cancelled && Object.keys(merged).length > 0) setThumbUrls(prev => ({ ...prev, ...merged }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, customerId])

  if (groups.length === 0) return null

  // 同じ日に同じ角度が複数枚ある場合のみ、撮影時刻を併記して見分けられるようにする。
  const angleCounts = new Map<string, number>()
  for (const p of activeGroup?.photos ?? []) angleCounts.set(p.bodyPart, (angleCounts.get(p.bodyPart) ?? 0) + 1)

  return (
    <div
      style={{
        marginTop: '16px', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
        borderRadius: '16px', padding: '16px 0 14px', boxShadow: PALETTE.shadow,
      }}
    >
      <p style={{ margin: '0 0 10px', padding: '0 16px', fontSize: '12px', letterSpacing: '0.1em', color: PALETTE.muted }}>
        過去の写真
      </p>

      {/* 撮影日チップ(新しい順・横スクロール)。 */}
      <div
        role="tablist"
        aria-label="撮影日"
        style={{
          display: 'flex', gap: '8px', overflowX: 'auto', padding: '0 16px 4px',
          touchAction: 'pan-x', WebkitOverflowScrolling: 'touch',
        }}
      >
        {groups.map(g => {
          const selected = g.dateKey === activeKey
          return (
            <button
              key={g.dateKey}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSelectedKey(g.dateKey)}
              style={{
                flex: '0 0 auto', minWidth: '60px', minHeight: '44px', padding: '0 16px',
                borderRadius: '22px', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                border: `1.5px solid ${selected ? PALETTE.gold : PALETTE.border}`,
                background: selected ? PALETTE.gold : 'none',
                color: selected ? '#FFFFFF' : PALETTE.text,
              }}
            >
              {formatDateChipLabel(g.dateKey, year)}
            </button>
          )
        })}
      </div>

      {/* 選択した日の写真(横スクロール1列。1枚ずつ独立表示)。 */}
      {activeGroup && (
        <div
          style={{
            display: 'flex', gap: '10px', overflowX: 'auto', padding: '12px 16px 2px',
            touchAction: 'pan-x', WebkitOverflowScrolling: 'touch',
          }}
        >
          {activeGroup.photos.map(photo => {
            const url = knownUrls[photo.id] ?? thumbUrls[photo.id]
            const label = photoAngleLabel(photo.bodyPart)
            const time = (angleCounts.get(photo.bodyPart) ?? 0) > 1 ? formatJstTime(photo.takenAt) : ''
            return (
              <div key={photo.id} style={{ flex: '0 0 auto', width: '132px' }}>
                <button
                  type="button"
                  onClick={() => onOpenPhoto(photo)}
                  aria-label={`${label}${time ? ` ${time}` : ''}の写真を拡大表示`}
                  style={{
                    display: 'block', width: '100%', aspectRatio: '4 / 5', padding: 0, cursor: 'pointer',
                    borderRadius: '10px', overflow: 'hidden', background: '#EFE8DA',
                    border: `1px solid ${PALETTE.border}`,
                  }}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ImageOff size={16} strokeWidth={1.3} color={PALETTE.gold} />
                    </div>
                  )}
                </button>
                <p style={{ margin: '5px 0 0', fontSize: '12px', color: PALETTE.text, textAlign: 'center' }}>
                  {label}
                  {time && <span style={{ color: PALETTE.muted }}> {time}</span>}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

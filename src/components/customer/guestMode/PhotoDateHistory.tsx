'use client'
/**
 * PhotoDateHistory.tsx — お客様カルテの写真履歴UI(2コンポーネント)。
 *
 *   - TodayPhotos(既定exportではない): 「今日撮影した写真」。大きな比較写真の直下に、今日(JST)
 *     撮影した写真を横スクロール1列で全部並べる。今日の写真が無ければ何も表示しない。
 *   - PhotoDateHistory(既定export): 「過去の写真」。今日より前の撮影日を新しい順にチップで並べ、
 *     選んだ日の写真を横スクロール1列で全部表示する(初期選択は最新の過去の撮影日)。
 *
 * 共通: 撮影日は taken_at のJST暦日。1枚ずつ独立して表示し、同日同角度の複数枚も統合・代表写真化しない。
 * 旧データ(face_left45等)も除外しない。写真タップは親(CustomerModeView)の既存ライトボックスを
 * 開く(onOpenPhoto)。サムネイルURLは既存の getBatchSignedUrls('thumbnail') を、表示する日の分だけ取得する。
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
  toJstDateKey,
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

/** 表示する写真のサムネイルURLを、足りない分だけ取得する。 */
function useThumbUrls(customerId: string, shown: TimelinePhoto[], knownUrls: Record<string, string>) {
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const missing = shown.map(p => p.id).filter(id => !knownUrls[id] && !thumbUrls[id])
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
  }, [shown, customerId])
  return thumbUrls
}

const cardStyle: React.CSSProperties = {
  marginTop: '16px', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
  borderRadius: '16px', padding: '16px 0 14px', boxShadow: PALETTE.shadow,
}

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 10px', padding: '0 16px', fontSize: '12px', letterSpacing: '0.1em', color: PALETTE.muted,
}

/** 写真の横スクロール1列(1枚ずつ独立表示)。 */
function PhotoRow({
  photos, urls, onOpenPhoto,
}: { photos: TimelinePhoto[]; urls: Record<string, string>; onOpenPhoto: (photo: TimelinePhoto) => void }) {
  // 同じ日に同じ角度が複数枚ある場合のみ、撮影時刻を併記して見分けられるようにする。
  const angleCounts = new Map<string, number>()
  for (const p of photos) angleCounts.set(p.bodyPart, (angleCounts.get(p.bodyPart) ?? 0) + 1)

  return (
    <div
      style={{
        display: 'flex', gap: '10px', overflowX: 'auto', padding: '12px 16px 2px',
        touchAction: 'pan-x', WebkitOverflowScrolling: 'touch',
      }}
    >
      {photos.map(photo => {
        const url = urls[photo.id]
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
  )
}

/** 今日(JST)の撮影日キー。 */
function todayJstKey(): string {
  return toJstDateKey(new Date().toISOString()) ?? ''
}

/** 「今日撮影した写真」。今日(JST)撮影した写真が無ければ何も表示しない。 */
export function TodayPhotos({ customerId, photos, knownUrls, onOpenPhoto }: Props) {
  const todayPhotos = useMemo(() => {
    const today = todayJstKey()
    return groupPhotosByJstDate(photos).find(g => g.dateKey === today)?.photos ?? []
  }, [photos])
  const urls = useThumbUrls(customerId, todayPhotos, knownUrls)
  const merged = useMemo(() => ({ ...urls, ...knownUrls }), [urls, knownUrls])

  if (todayPhotos.length === 0) return null
  return (
    <div style={cardStyle}>
      <p style={cardTitleStyle}>今日撮影した写真</p>
      <PhotoRow photos={todayPhotos} urls={merged} onOpenPhoto={onOpenPhoto} />
    </div>
  )
}

/** 「過去の写真」。今日より前の撮影日チップ → 選んだ日の写真を全部表示。 */
export default function PhotoDateHistory({ customerId, photos, knownUrls, onOpenPhoto }: Props) {
  const groups = useMemo(() => {
    const today = todayJstKey()
    return groupPhotosByJstDate(photos).filter(g => g.dateKey !== today)
  }, [photos])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // 選択が無い・消えた(写真削除等)場合は最新の過去の撮影日を選ぶ。
  const activeKey = groups.some(g => g.dateKey === selectedKey) ? selectedKey : (groups[0]?.dateKey ?? null)
  const activeGroup = groups.find(g => g.dateKey === activeKey) ?? null
  const shown = useMemo(() => activeGroup?.photos ?? [], [activeGroup])
  const urls = useThumbUrls(customerId, shown, knownUrls)
  const merged = useMemo(() => ({ ...urls, ...knownUrls }), [urls, knownUrls])
  const year = currentJstYear()

  if (groups.length === 0) return null

  return (
    <div style={cardStyle}>
      <p style={cardTitleStyle}>過去の写真</p>

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

      {activeGroup && <PhotoRow photos={activeGroup.photos} urls={merged} onOpenPhoto={onOpenPhoto} />}
    </div>
  )
}

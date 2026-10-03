'use client'
/**
 * PhotoDateHistory.tsx — お客様カルテの写真履歴UI(2コンポーネント)。
 *
 *   - TodayPhotos: 「今日撮影した写真」。大きな比較写真の直下に、今日(JST)
 *     撮影した写真を横スクロール1列で全部並べる。今日の写真が無ければ何も表示しない。
 *   - PhotoDateHistory(既定export): 「過去の写真」。今日より前の撮影日を新しい順にチップで並べ、
 *     選んだ日の写真を横スクロール1列で全部表示する(初期選択は最新の過去の撮影日)。
 *
 * 共通: 写真サムネイルのタップは、通常モードでは操作メニュー(拡大して見る/比較対象に設定/
 * 自由選択モードで選ぶ)を開き、自由選択モード中はメニューなしで直接 selectPhotoForCompare する
 * (親=CustomerModeViewの既存の比較ロジック・pinSlot表現をそのまま使う。ここでは比較ロジックを持たない)。
 * 共通: 撮影日は taken_at のJST暦日。1枚ずつ独立して表示し、同日同角度の複数枚も統合・代表写真化しない。
 * 旧データ(face_left45等)も除外しない。サムネイルURLは既存の getBatchSignedUrls('thumbnail') を、表示する日の分だけ取得する。
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
  /** 既に取得済みのURL(比較パネル用の事前取得分など)。あれば再取得しない。 */
  knownUrls: Record<string, string>
  /** サムネイルURLを取得できた時に親へ渡す(ライトボックスの先行表示用キャッシュに使う)。 */
  onThumbsLoaded?: (urls: Record<string, string>) => void
  /** 自由選択モード中か(CustomerModeViewのfreeSelectMode)。 */
  freeSelectMode: boolean
  /** 比較対象としての選択状態(1=1枚目・2=2枚目・null=未選択。既存のpinSlotと同じ)。 */
  pinSlotOf: (photoId: string) => 1 | 2 | null
  /** 既存のライトボックス(openPhotoInLightbox)。 */
  onOpenPhoto: (photo: TimelinePhoto) => void
  /** 既存のselectPhotoForCompare(ピン留め/解除/先入れ先出し)。自由選択モード中のタップで直接呼ぶ。 */
  onSelectForCompare: (photo: TimelinePhoto) => void
  /** 自由選択モードをONにするだけ(setFreeSelectMode(true))。 */
  onStartFreeSelect: () => void
  /** 自由選択モードをONにした上で、この写真をselectPhotoForCompareする。 */
  onSetCompareTarget: (photo: TimelinePhoto) => void
  /** 比較対象(1枚目/2枚目)からこの写真を外すだけ(モードは変えない)。 */
  onRemoveCompareTarget: (photo: TimelinePhoto) => void
  /** 自由選択モードを終了する(選択中の1/2もクリアする。上部の「🔀 自由選択」をOFFにするのと同じ)。 */
  onEndFreeSelect: () => void
}

/** 表示する写真のサムネイルURLを、足りない分だけ取得する。 */
function useThumbUrls(
  customerId: string,
  shown: TimelinePhoto[],
  knownUrls: Record<string, string>,
  onLoaded?: (urls: Record<string, string>) => void,
) {
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
      if (!cancelled && Object.keys(merged).length > 0) {
        setThumbUrls(prev => ({ ...prev, ...merged }))
        onLoaded?.(merged)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, customerId])
  return thumbUrls
}

const cardStyle: React.CSSProperties = {
  marginTop: '16px', background: PALETTE.bg, border: `1px solid ${PALETTE.border}`,
  borderRadius: '16px', padding: '16px 0 14px',
}

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 10px', padding: '0 16px', fontSize: '12px', letterSpacing: '0.1em', color: PALETTE.muted,
}

/** 写真の横スクロール1列(1枚ずつ独立表示)。 */
function PhotoRow({
  photos, urls, freeSelectMode, pinSlotOf, onTap, onOpenMenu,
}: {
  photos: TimelinePhoto[]
  urls: Record<string, string>
  freeSelectMode: boolean
  pinSlotOf: (photoId: string) => 1 | 2 | null
  onTap: (photo: TimelinePhoto) => void
  /** 操作メニューを開く(自由選択モード中は、タップが直接の選択になるため、この「⋯」から開く)。 */
  onOpenMenu: (photo: TimelinePhoto) => void
}) {
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
        const pinSlot = pinSlotOf(photo.id)
        const name = `${label}${time ? ` ${time}` : ''}`
        return (
          <div key={photo.id} style={{ position: 'relative', flex: '0 0 auto', width: '132px' }}>
            <button
              type="button"
              onClick={() => onTap(photo)}
              aria-label={
                freeSelectMode
                  ? (pinSlot ? `${name}の写真の選択を解除` : `${name}の写真を比較対象に選ぶ`)
                  : `${name}の写真の操作メニューを開く`
              }
              style={{
                position: 'relative', display: 'block', width: '100%', aspectRatio: '4 / 5', padding: 0, cursor: 'pointer',
                borderRadius: '10px', overflow: 'hidden', background: '#EFE8DA',
                border: pinSlot ? `2px solid ${PALETTE.gold}` : `1px solid ${PALETTE.border}`,
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
              {pinSlot && (
                <span
                  style={{
                    position: 'absolute', top: '4px', left: '4px', width: '18px', height: '18px',
                    borderRadius: '50%', background: PALETTE.gold, color: '#FFFFFF',
                    fontSize: '10px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {pinSlot}
                </span>
              )}
            </button>
            {freeSelectMode && (
              <button
                type="button"
                onClick={() => onOpenMenu(photo)}
                aria-label={`${name}の写真の操作メニューを開く`}
                style={{
                  position: 'absolute', top: '0', right: '0', width: '44px', height: '44px',
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(20,16,12,0.65)',
                    color: '#fff', fontSize: '16px', lineHeight: '26px', textAlign: 'center',
                  }}
                >
                  ⋯
                </span>
              </button>
            )}
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

/**
 * 通常モードで写真をタップしたときの操作メニュー(拡大して見る/比較対象に設定/自由選択モードで選ぶ)。
 * ボタンは全て高さ52px(iPadで押しやすい44px以上)。背景タップ・「閉じる」で閉じる。
 */
function PhotoActionMenu({
  photo, pinSlot, freeSelectMode, onClose, onOpenPhoto, onStartFreeSelect, onEndFreeSelect,
  onSetCompareTarget, onRemoveCompareTarget,
}: {
  photo: TimelinePhoto
  pinSlot: 1 | 2 | null
  freeSelectMode: boolean
  onClose: () => void
  onOpenPhoto: (photo: TimelinePhoto) => void
  onStartFreeSelect: () => void
  onEndFreeSelect: () => void
  onSetCompareTarget: (photo: TimelinePhoto) => void
  onRemoveCompareTarget: (photo: TimelinePhoto) => void
}) {
  const buttonStyle: React.CSSProperties = {
    width: '100%', minHeight: '52px', padding: '0 16px', borderRadius: '12px', cursor: 'pointer',
    fontSize: '15px', fontWeight: 600, border: `1.5px solid ${PALETTE.border}`, background: 'none', color: PALETTE.text,
  }
  const run = (fn: () => void) => () => { onClose(); fn() }
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 315, background: 'rgba(30,24,16,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <div
        role="dialog"
        aria-label="写真の操作"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '360px', background: PALETTE.bg, borderRadius: '18px', padding: '18px',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}
      >
        <p style={{ margin: '0 0 4px', textAlign: 'center', fontSize: '13px', color: PALETTE.muted }}>
          {photoAngleLabel(photo.bodyPart)}
        </p>
        <button type="button" style={buttonStyle} onClick={run(() => onOpenPhoto(photo))}>
          写真を拡大して見る
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, ...(pinSlot ? {} : { border: `1.5px solid ${PALETTE.gold}` }) }}
          onClick={run(() => (pinSlot ? onRemoveCompareTarget(photo) : onSetCompareTarget(photo)))}
        >
          {pinSlot ? '比較対象から外す' : '比較対象に設定'}
        </button>
        {freeSelectMode ? (
          <button type="button" style={buttonStyle} onClick={run(onEndFreeSelect)}>
            自由選択モードを終了
          </button>
        ) : (
          <button type="button" style={buttonStyle} onClick={run(onStartFreeSelect)}>
            自由選択モードで選ぶ
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{ ...buttonStyle, border: 'none', color: PALETTE.muted, fontWeight: 500 }}
        >
          閉じる
        </button>
      </div>
    </div>
  )
}

/**
 * サムネイルタップの共通処理。自由選択モード中はメニューなしで直接 selectPhotoForCompare、
 * 通常モードでは操作メニューを開く。
 */
function usePhotoTap(p: Pick<Props, 'freeSelectMode' | 'pinSlotOf' | 'onSelectForCompare' | 'onRemoveCompareTarget'>) {
  const [menuPhoto, setMenuPhoto] = useState<TimelinePhoto | null>(null)
  const onTap = (photo: TimelinePhoto) => {
    if (p.freeSelectMode) {
      // 既に選択中(1/2)の写真を再タップしたら選択解除、未選択なら選択(先入れ先出し)。
      if (p.pinSlotOf(photo.id)) p.onRemoveCompareTarget(photo)
      else p.onSelectForCompare(photo)
    } else setMenuPhoto(photo)
  }
  return { menuPhoto, closeMenu: () => setMenuPhoto(null), openMenu: setMenuPhoto, onTap }
}

/** 今日(JST)の撮影日キー。 */
function todayJstKey(): string {
  return toJstDateKey(new Date().toISOString()) ?? ''
}

/** 「今日撮影した写真」。今日(JST)撮影した写真が無ければ何も表示しない。 */
export function TodayPhotos(props: Props) {
  const { customerId, photos, knownUrls, onThumbsLoaded, freeSelectMode, pinSlotOf } = props
  const { menuPhoto, closeMenu, openMenu, onTap } = usePhotoTap(props)
  const todayPhotos = useMemo(() => {
    const today = todayJstKey()
    return groupPhotosByJstDate(photos).find(g => g.dateKey === today)?.photos ?? []
  }, [photos])
  const urls = useThumbUrls(customerId, todayPhotos, knownUrls, onThumbsLoaded)
  const merged = useMemo(() => ({ ...urls, ...knownUrls }), [urls, knownUrls])

  if (todayPhotos.length === 0) return null
  return (
    <div style={cardStyle}>
      <p style={cardTitleStyle}>今日撮影した写真</p>
      <PhotoRow photos={todayPhotos} urls={merged} freeSelectMode={freeSelectMode} pinSlotOf={pinSlotOf} onTap={onTap} onOpenMenu={openMenu} />
      {menuPhoto && (
        <PhotoActionMenu
          photo={menuPhoto}
          pinSlot={pinSlotOf(menuPhoto.id)}
          freeSelectMode={freeSelectMode}
          onClose={closeMenu}
          onOpenPhoto={props.onOpenPhoto}
          onStartFreeSelect={props.onStartFreeSelect}
          onEndFreeSelect={props.onEndFreeSelect}
          onSetCompareTarget={props.onSetCompareTarget}
          onRemoveCompareTarget={props.onRemoveCompareTarget}
        />
      )}
    </div>
  )
}

/** 「過去の写真」。今日より前の撮影日チップ → 選んだ日の写真を全部表示。 */
export default function PhotoDateHistory(props: Props) {
  const { customerId, photos, knownUrls, onThumbsLoaded, freeSelectMode, pinSlotOf } = props
  const { menuPhoto, closeMenu, openMenu, onTap } = usePhotoTap(props)
  const groups = useMemo(() => {
    const today = todayJstKey()
    return groupPhotosByJstDate(photos).filter(g => g.dateKey !== today)
  }, [photos])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // 選択が無い・消えた(写真削除等)場合は最新の過去の撮影日を選ぶ。
  const activeKey = groups.some(g => g.dateKey === selectedKey) ? selectedKey : (groups[0]?.dateKey ?? null)
  const activeGroup = groups.find(g => g.dateKey === activeKey) ?? null
  const shown = useMemo(() => activeGroup?.photos ?? [], [activeGroup])
  const urls = useThumbUrls(customerId, shown, knownUrls, onThumbsLoaded)
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

      {activeGroup && (
        <PhotoRow photos={activeGroup.photos} urls={merged} freeSelectMode={freeSelectMode} pinSlotOf={pinSlotOf} onTap={onTap} onOpenMenu={openMenu} />
      )}
      {menuPhoto && (
        <PhotoActionMenu
          photo={menuPhoto}
          pinSlot={pinSlotOf(menuPhoto.id)}
          freeSelectMode={freeSelectMode}
          onClose={closeMenu}
          onOpenPhoto={props.onOpenPhoto}
          onStartFreeSelect={props.onStartFreeSelect}
          onEndFreeSelect={props.onEndFreeSelect}
          onSetCompareTarget={props.onSetCompareTarget}
          onRemoveCompareTarget={props.onRemoveCompareTarget}
        />
      )}
    </div>
  )
}

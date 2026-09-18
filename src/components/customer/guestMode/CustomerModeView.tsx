'use client'
/**
 * CustomerModeView.tsx — 「お客様モード」画面(PHASE GUEST-MODE-1・2026-09-10)。
 *
 * スタッフがiPadをお客様に向けて、前回と今回のお肌の変化を一緒に確認するための
 * 専用画面。CustomerBottomSheet(スタッフ画面)とは完全に分離した独立コンポーネントで、
 * スタッフ専用コンポーネント(ContraindicationSection・AIProposalCard・
 * NextActionPanel・StaffProposalSection・LINE関連・CustomerRiskCard等)を
 * 一切importしない。これにより「お客様モードでは内部情報を描画しない」を、
 * CSSでの非表示ではなくコンポーネントツリー自体の分離で実現する
 * (ユーザー指示 2026-09-10)。AIProposalCardを一切importしていないため、
 * お客様モードを開いたことをきっかけに /api/proposals/fire が呼ばれることもない。
 *
 * データは既存API(customerModeData.ts参照)のみを再利用し、新規API・新規DB・
 * Storage変更は一切行わない。customerId/customerNameのみを受け取り、他は
 * 自前でfetchする自己完結コンポーネント(GoalSection等と同じ設計方針)。
 *
 * デザイン方針: アイボリー×ベージュ×ゴールド×ダークブラウン。大きな余白・細い境界線・
 * 控えめなシャドウ。業務アプリ感を避け、美容サロンらしい落ち着いた高級感を優先する。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Playfair_Display } from 'next/font/google'
import { X, Leaf, CalendarDays, Flower2, ImageOff, SlidersHorizontal } from 'lucide-react'
import {
  useCustomerModeData,
  CUSTOMER_MODE_ANGLES,
  type CustomerModeAngleId,
} from './customerModeData'
import {
  groupByOccasion,
  representativePhoto,
  buildPreviousComparison,
  buildFirstComparison,
  hasDistinctFirstOccasion,
  type BodyPartPhotoGroup,
  type ComparisonBasis,
  type PhotoOccasion,
} from '@/lib/photos/comparisonSelection'
import { getPhotoSignedUrl, getBatchSignedUrls, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { usePinchZoom } from './usePinchZoom'
import PhotoCompareScreen from '@/components/customer/photoCompare/PhotoCompareScreen'
import {
  PALETTE,
  headingFont,
  Card,
  PhotoPanel,
  SkinTagRow,
  InfoBarItem,
  formatVisitDateLabel,
} from '@/components/customer/shared/PhotoCompareKit'
import { useNextVisit } from '@/lib/nextVisit/useNextVisit'
import { formatWeeksLabel, type NextVisitResult } from '@/lib/nextVisit/nextVisitEngine'

// ロゴ用: エレガントな欧文セリフ体(イタリック)。高級サロンのブランドロゴらしい質感のため
// システム標準フォントのitalic指定をやめ、専用フォントを読み込む(PHASE GUEST-MODE-1-DESIGN)。
const logoFont = Playfair_Display({ subsets: ['latin'], weight: '600', style: 'italic', display: 'swap' })

/**
 * 表示の一時停止(スタッフ操作フィードバック対応・2026-09-18ユーザー承認、写真カルテUI
 * 改善のPart 4)。「今回のホームケア」「次回のお手入れ目安」カードを一時的に非表示にする。
 * データ取得(data.homecareItems・useNextVisit)・API・DBには一切手を加えていない
 * (このフラグは表示のJSXをガードするだけ)。既存の`nextVisit.hiddenFromCustomer`
 * (顧客ごとにスタッフが個別設定する別機能)とは無関係で、今回は一律停止する。
 * 再表示する場合はこの2つをtrueに戻すだけでよい。IpadStaffKarteView.tsxの同名フラグと
 * 対応関係にある(値は必ず両方同時に切り替える)。
 */
const SHOW_HOMECARE = false
const SHOW_NEXT_VISIT_ESTIMATE = false

interface Props {
  customerId: string
  customerName: string
  onClose: () => void
}

export default function CustomerModeView({ customerId, customerName, onClose }: Props) {
  const data = useCustomerModeData(customerId)
  const [angle, setAngle] = useState<CustomerModeAngleId>('face_front')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  // スクロール領域への参照。「過去の写真」サムネイルタップ時に拡大モードの表示(上部)まで
  // スクロールを戻すために使う(お客様用カルテ再構成・2026-09-14)。
  const scrollRef = useRef<HTMLDivElement>(null)

  // 次回目安エンジン(PHASE NEXT-VISIT-1・2026-09-11)。お客様モードでは具体的な日付は出さず、
  // 「約◯週間後」のみ表示する(次回予約が既にある場合のみ日付を表示)。
  const nextVisit = useNextVisit(customerId)

  // 写真カルテ 比較｜拡大モード切替(PHASE GUEST-MODE-3・2026-09-12)。
  const [photoMode, setPhotoMode] = useState<'compare' | 'enlarge'>('compare')
  const [compareBasis, setCompareBasis] = useState<ComparisonBasis>('previous')
  // スライダー比較(PhotoCompareScreen、2026-09-17導線変更): 撮影用ゴースト/ジャイロ画面
  // (IpadPhotoCaptureModal.tsx)とは無関係の、保存済み写真の閲覧専用モーダル。
  // お客様に見せる画面であるお客様モード側に導線を集約する(スタッフ用カルテからは削除済み)。
  const [sliderCompareOpen, setSliderCompareOpen] = useState(false)
  // 拡大モードで選択中の撮影機会key(comparisonSelection.tsのoccasionKey形式と同じ)。
  // null = 「今回」(最新の撮影機会)を表す。全来店日リストから選ぶと`visit:${visitId}`になる。
  const [enlargeOccasionKey, setEnlargeOccasionKey] = useState<string | null>(null)
  // 全来店日リストで選んだ回のメタ情報。選んだ回にこの角度の写真が無い場合の
  // 空状態表示に使う(ショートカット/デフォルト選択時はnullのまま、写真自身から情報を出す)。
  const [enlargeFallbackTab, setEnlargeFallbackTab] = useState<{ visitCountAt: number; visitDate: string | null } | null>(null)
  // 事前取得(photoUrls)に無い写真のsigned URL。全来店日リストから任意の回を選んだ場合のみ
  // 都度取得する(来店回数が多い顧客で全件事前取得すると無駄なsigned URL発行が増えるため)。
  const [extraPhotoUrls, setExtraPhotoUrls] = useState<Record<string, string>>({})

  // 「過去の写真」サムネイル一覧用のsigned URL(お客様用カルテ再構成・2026-09-14)。
  // 現在選択中の角度の撮影機会(occasions)ごとの代表写真をまとめて取得する
  // (角度タブに連動。角度を切り替えるたびに取り直す)。
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})

  // 写真の自由選択比較(お客様用カルテ自由選択比較・2026-09-15・設計確定)。
  // 「前回↔今回」「初回↔今回」ショートカットとは独立した第3の選択肢で、来店回・角度を
  // 問わず任意の2枚を選べる。角度をまたいで選択を保持する必要があるため、下の
  // 角度切替リセットuseEffectの対象には含めない。
  const [freeSelectMode, setFreeSelectMode] = useState(false)
  const [selectedPhotoA, setSelectedPhotoA] = useState<TimelinePhoto | null>(null)
  const [selectedPhotoB, setSelectedPhotoB] = useState<TimelinePhoto | null>(null)

  // 角度切替時は比較・拡大の選択状態をリセットする(別の角度の撮影機会を参照し続けるのを防ぐ)。
  useEffect(() => {
    setCompareBasis('previous')
    setEnlargeOccasionKey(null)
    setEnlargeFallbackTab(null)
  }, [angle])

  const angleGroup: BodyPartPhotoGroup = useMemo(
    () => ({ bodyPart: angle, photos: data.photosByAngle[angle] ?? [] }),
    [angle, data.photosByAngle]
  )
  const occasions = useMemo(() => groupByOccasion(angleGroup.photos), [angleGroup])
  const isComparable = occasions.length >= 2
  const showFirstShortcut = hasDistinctFirstOccasion(angleGroup)

  // 「過去の写真」サムネイル: 現在の角度の撮影機会ごとに代表写真のsigned URLをまとめて取得する。
  // photoUrls(前回/今回/初回として既に事前取得済みのもの)は再利用し、不足分だけ取りに行く。
  useEffect(() => {
    const missingIds = occasions
      .map(o => representativePhoto(o).id)
      .filter(id => !data.photoUrls[id] && !thumbUrls[id])
    if (missingIds.length === 0) return
    let cancelled = false
    void getBatchSignedUrls(customerId, missingIds, 'thumbnail').then(urls => {
      if (!cancelled && Object.keys(urls).length > 0) setThumbUrls(prev => ({ ...prev, ...urls }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasions, customerId])

  // 比較モード: 「前回↔今回」「初回↔今回」ショートカット切替。既存のcomparisonSelection.ts
  // 公開関数のみを使い、比較ロジック自体は変更しない。
  const comparePair = useMemo(() => {
    if (!isComparable) return null
    return compareBasis === 'previous' ? buildPreviousComparison(angleGroup) : buildFirstComparison(angleGroup)
  }, [angleGroup, isComparable, compareBasis])
  const compareCurrentPhoto = comparePair?.current ?? (occasions[0] ? representativePhoto(occasions[0]) : null)
  const compareReferencePhoto = comparePair?.reference ?? null
  const compareCurrentUrl = compareCurrentPhoto ? data.photoUrls[compareCurrentPhoto.id] : undefined
  const compareReferenceUrl = compareReferencePhoto ? data.photoUrls[compareReferencePhoto.id] : undefined

  // 自由選択で選んだ写真のsigned URL(detail品質)。photoUrls(前回/初回/今回として
  // 事前取得済みのもの)に無ければ都度取得する(enlargedPhotoと同じパターン)。
  const [freeCompareUrls, setFreeCompareUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const need = [selectedPhotoA, selectedPhotoB]
      .filter((p): p is TimelinePhoto => !!p)
      .filter(p => !data.photoUrls[p.id] && !freeCompareUrls[p.id])
    if (need.length === 0) return
    let cancelled = false
    void getBatchSignedUrls(customerId, need.map(p => p.id), 'detail').then(urls => {
      if (!cancelled && Object.keys(urls).length > 0) setFreeCompareUrls(prev => ({ ...prev, ...urls }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotoA?.id, selectedPhotoB?.id, customerId])

  // 2枚が揃った瞬間、写真表示エリア(画面上部)までスクロールし直す
  // (「過去の写真」サムネイルタップ時の拡大モード切替と同じ挙動)。
  useEffect(() => {
    if (freeSelectMode && selectedPhotoA && selectedPhotoB) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotoA?.id, selectedPhotoB?.id])

  // 比較パネルの左右(自由選択モードでは選んだ順=左が1枚目・右が2枚目で固定。
  // 通常モードではショートカットのペアをそのまま使う)。
  const leftPhoto  = freeSelectMode ? selectedPhotoA : compareReferencePhoto
  const rightPhoto = freeSelectMode ? selectedPhotoB : compareCurrentPhoto
  const leftUrl  = freeSelectMode
    ? (selectedPhotoA ? (data.photoUrls[selectedPhotoA.id] ?? freeCompareUrls[selectedPhotoA.id]) : undefined)
    : compareReferenceUrl
  const rightUrl = freeSelectMode
    ? (selectedPhotoB ? (data.photoUrls[selectedPhotoB.id] ?? freeCompareUrls[selectedPhotoB.id]) : undefined)
    : compareCurrentUrl
  const leftLabel  = freeSelectMode ? '選択した1枚目' : (compareBasis === 'previous' ? '前回' : '初回')
  const rightLabel = freeSelectMode ? '選択した2枚目' : '今回'
  const leftEmptyText  = freeSelectMode
    ? '「過去の写真」から1枚目をタップして選んでください'
    : (compareBasis === 'previous' ? '前回の写真はまだありません' : '初回の写真はまだありません')
  const rightEmptyText = freeSelectMode ? '「過去の写真」から2枚目をタップして選んでください' : 'まだ写真がありません'

  // 拡大モード: 「初回」「前回」ショートカット＋全来店日リストから選んだ1枚を単独表示。
  const enlargedOccasion = useMemo(() => {
    if (occasions.length === 0) return null
    if (enlargeOccasionKey === null) return occasions[0]
    return occasions.find(o => o.key === enlargeOccasionKey) ?? null
  }, [occasions, enlargeOccasionKey])
  const enlargedPhoto = enlargedOccasion ? representativePhoto(enlargedOccasion) : null
  const enlargedUrl = enlargedPhoto
    ? (data.photoUrls[enlargedPhoto.id] ?? extraPhotoUrls[enlargedPhoto.id] ?? thumbUrls[enlargedPhoto.id])
    : undefined
  const enlargedLoading = !!enlargedPhoto && !enlargedUrl
  // ハイライト対象のvisitId。写真が見つかった場合は写真自身のvisitId、
  // 「選んだ回にこの角度の写真が無い」空状態の場合はkeyから逆算する。
  const enlargedActiveVisitId = enlargedPhoto?.visitId
    ?? (enlargeOccasionKey?.startsWith('visit:') ? enlargeOccasionKey.slice('visit:'.length) : null)

  useEffect(() => {
    if (!enlargedPhoto) return
    if (data.photoUrls[enlargedPhoto.id] || extraPhotoUrls[enlargedPhoto.id] || thumbUrls[enlargedPhoto.id]) return
    let cancelled = false
    void getPhotoSignedUrl(customerId, enlargedPhoto.id, 'detail').then(url => {
      if (!cancelled && url) setExtraPhotoUrls(prev => ({ ...prev, [enlargedPhoto.id]: url }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enlargedPhoto?.id, customerId])

  /**
   * 「過去の写真」サムネイルタップ: 既存の拡大モード(比較｜拡大の「拡大」)へそのまま切り替える
   * (お客様用カルテ再構成・2026-09-14)。新しい表示ロジックは増やさず、拡大モードの状態
   * (photoMode/enlargeOccasionKey)を書き換えるだけ。画面上部の写真表示エリアまで
   * スクロールし直す。
   */
  function openOccasionInEnlargeMode(o: PhotoOccasion) {
    setPhotoMode('enlarge')
    setEnlargeOccasionKey(o.key)
    setEnlargeFallbackTab(null)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * 「過去の写真」サムネイルタップ: 自由選択モード中(かつ比較タブ表示中)は比較対象への
   * ピン留め/解除、それ以外は従来通り拡大モードへの切り替え(お客様用カルテ自由選択比較・
   * 2026-09-15・設計確定)。3枚目のタップは先入れ先出し(1枚目を追い出し、2枚目だった
   * 写真を1枚目へ繰り上げ、新しい写真を2枚目にする)で「常に直近タップした2枚」を維持する。
   */
  function onThumbnailTap(o: PhotoOccasion) {
    if (!freeSelectMode || photoMode !== 'compare') {
      openOccasionInEnlargeMode(o)
      return
    }
    const photo = representativePhoto(o)
    if (selectedPhotoA?.id === photo.id) { setSelectedPhotoA(null); return }
    if (selectedPhotoB?.id === photo.id) { setSelectedPhotoB(null); return }
    if (!selectedPhotoA) {
      setSelectedPhotoA(photo)
    } else if (!selectedPhotoB) {
      setSelectedPhotoB(photo)
    } else {
      setSelectedPhotoA(selectedPhotoB)
      setSelectedPhotoB(photo)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── ヘッダー(常時表示) ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 28px 16px',
          background: PALETTE.bg,
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <div>
          <p
            style={{
              margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '20px', color: PALETTE.gold, letterSpacing: '0.01em',
              fontFamily: logoFont.style.fontFamily,
            }}
          >
            <Flower2 size={16} strokeWidth={1.4} color={PALETTE.gold} />
            Salon Riora
          </p>
          <p
            style={{
              margin: '4px 0 0', fontSize: '9px', letterSpacing: '0.2em', color: PALETTE.muted,
              textTransform: 'uppercase',
            }}
          >
            Japanese High-End Aesthetic Salon
          </p>
        </div>
        <p
          style={{
            margin: 0, fontSize: '18px', color: PALETTE.text, letterSpacing: '0.04em',
            whiteSpace: 'nowrap', fontFamily: headingFont.style.fontFamily,
          }}
        >
          お肌の変化を一緒に確認しましょう
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted, whiteSpace: 'nowrap' }}>
            {customerName}様
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="お客様モードを終了"
            style={{
              width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
              background: PALETTE.card, border: `1.5px solid ${PALETTE.gold}`, color: PALETTE.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={22} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── スクロール領域(「1画面目」+「スクロール部分」を1つの連続スクロールにまとめる) ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 16px 48px' }}>

          {/* 角度タブ */}
          <div style={{ display: 'flex', gap: '32px', borderBottom: `1px solid ${PALETTE.border}`, marginBottom: '20px' }}>
            {CUSTOMER_MODE_ANGLES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAngle(a.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0 0 12px', fontSize: '15px', letterSpacing: '0.06em',
                  color: angle === a.id ? PALETTE.text : PALETTE.muted,
                  borderBottom: angle === a.id ? `2px solid ${PALETTE.gold}` : '2px solid transparent',
                  fontFamily: headingFont.style.fontFamily,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {data.loading ? (
            <p style={{ textAlign: 'center', color: PALETTE.muted, fontSize: '13px', padding: '48px 0' }}>
              読み込み中…
            </p>
          ) : (
            <>
              {/* 比較｜拡大 モード切替 + ショートカット(PHASE GUEST-MODE-3) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'inline-flex', background: PALETTE.bg, border: `1px solid ${PALETTE.border}`, borderRadius: '999px', padding: '3px' }}>
                    {(['compare', 'enlarge'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPhotoMode(m)}
                        style={{
                          padding: '7px 18px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                          fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em',
                          background: photoMode === m ? PALETTE.gold : 'transparent',
                          color: photoMode === m ? '#FFFFFF' : PALETTE.muted,
                        }}
                      >
                        {m === 'compare' ? '比較' : '拡大'}
                      </button>
                    ))}
                  </div>

                  {/* スライダー比較(PhotoCompareScreen、2026-09-17導線変更)。上の比較｜拡大とは
                      独立した別モーダルとして開く(既存のPhotoPanel・自由選択比較には手を加えない)。 */}
                  <button
                    type="button"
                    onClick={() => setSliderCompareOpen(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '7px 16px', borderRadius: '999px', cursor: 'pointer',
                      fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em',
                      border: `1px solid ${PALETTE.border}`, background: 'none', color: PALETTE.text,
                    }}
                  >
                    <SlidersHorizontal size={13} strokeWidth={1.8} color={PALETTE.gold} />
                    スライダーで比較
                  </button>
                </div>

                {photoMode === 'compare' && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {isComparable && (
                      <>
                        <ShortcutButton
                          active={!freeSelectMode && compareBasis === 'previous'}
                          onClick={() => { setFreeSelectMode(false); setCompareBasis('previous') }}
                        >
                          前回↔今回
                        </ShortcutButton>
                        {showFirstShortcut && (
                          <ShortcutButton
                            active={!freeSelectMode && compareBasis === 'first'}
                            onClick={() => { setFreeSelectMode(false); setCompareBasis('first') }}
                          >
                            初回↔今回
                          </ShortcutButton>
                        )}
                      </>
                    )}
                    {/* 自由選択(お客様用カルテ自由選択比較・2026-09-15)。来店回・角度を問わず
                        「過去の写真」から任意の2枚を選んで比較する。ONにすると解除するまで
                        選択が有効(選択内容は角度タブをまたいでも保持される)。 */}
                    <ShortcutButton
                      active={freeSelectMode}
                      onClick={() => {
                        setFreeSelectMode(v => {
                          const next = !v
                          if (!next) { setSelectedPhotoA(null); setSelectedPhotoB(null) }
                          return next
                        })
                      }}
                    >
                      🔀 自由選択
                    </ShortcutButton>
                  </div>
                )}

                {photoMode === 'enlarge' && occasions.length >= 2 && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {showFirstShortcut && (
                      <ShortcutButton
                        active={enlargedOccasion?.key === occasions[occasions.length - 1].key}
                        onClick={() => { setEnlargeOccasionKey(occasions[occasions.length - 1].key); setEnlargeFallbackTab(null) }}
                      >
                        初回
                      </ShortcutButton>
                    )}
                    <ShortcutButton
                      active={enlargedOccasion?.key === occasions[1]?.key}
                      onClick={() => { setEnlargeOccasionKey(occasions[1].key); setEnlargeFallbackTab(null) }}
                    >
                      前回
                    </ShortcutButton>
                  </div>
                )}
              </div>

              {/* 自由選択の状態表示(お客様用カルテ自由選択比較・2026-09-15)。2枚揃うまでの
                  案内と、選び直すためのクリア導線。 */}
              {photoMode === 'compare' && freeSelectMode && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
                  <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>
                    {selectedPhotoA && selectedPhotoB
                      ? '選択した2枚を比較表示しています(別の写真をタップすると入れ替わります)'
                      : !selectedPhotoA
                        ? '下の「過去の写真」から1枚目をタップして選んでください(角度タブを切り替えてもOK)'
                        : '2枚目をタップして選んでください'}
                  </p>
                  {(selectedPhotoA || selectedPhotoB) && (
                    <button
                      type="button"
                      onClick={() => { setSelectedPhotoA(null); setSelectedPhotoB(null) }}
                      style={{
                        background: 'none', border: 'none', color: PALETTE.gold, fontSize: '12px',
                        fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                      }}
                    >
                      選び直す
                    </button>
                  )}
                </div>
              )}

              {/* 写真表示: 比較モード(2枚並び・既存動作)｜拡大モード(1枚・ピンチズーム)。
                  PhotoPanel自体はobjectFit:containのため写真が見切れることは無いが、比較モードの
                  aspectRatioは既定値('5 / 4'・横長寄り)のままだと縦長の顔写真との差が大きく余白が
                  目立つため、実際の撮影写真に近い縦長比('4 / 5')を指定して余白を減らす。
                  IpadStaffKarteView側のPhotoPanel呼び出しはaspectRatio未指定のまま(既定値
                  '5 / 4')のため、この指定による影響はない。自由選択モード中は左=1枚目(A)・
                  右=2枚目(B)を選んだ順で固定表示する(leftPhoto/rightPhoto等を参照)。 */}
              {photoMode === 'compare' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <PhotoPanel
                    label={leftLabel}
                    url={leftUrl}
                    visitCountAt={leftPhoto?.visitCountAt ?? null}
                    visitDate={leftPhoto?.visitDate ?? leftPhoto?.takenAt ?? null}
                    emptyText={leftEmptyText}
                    onExpand={leftUrl ? () => setLightboxUrl(leftUrl) : undefined}
                    aspectRatio="4 / 5"
                  />
                  <PhotoPanel
                    label={rightLabel}
                    url={rightUrl}
                    visitCountAt={rightPhoto?.visitCountAt ?? null}
                    visitDate={rightPhoto?.visitDate ?? rightPhoto?.takenAt ?? null}
                    emptyText={rightEmptyText}
                    onExpand={rightUrl ? () => setLightboxUrl(rightUrl) : undefined}
                    aspectRatio="4 / 5"
                  />
                </div>
              ) : (
                <>
                  <EnlargedPhotoPanel
                    url={enlargedUrl}
                    loading={enlargedLoading}
                    photo={enlargedPhoto}
                    fallbackTab={enlargeFallbackTab}
                  />
                  {data.visitTabs.length > 0 && (
                    <div style={{ marginTop: '14px', display: 'flex', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' }}>
                      {data.visitTabs.map(tab => {
                        const key = `visit:${tab.visitId}`
                        const selected = enlargedActiveVisitId === tab.visitId
                        return (
                          <button
                            key={tab.visitId}
                            type="button"
                            onClick={() => {
                              setEnlargeOccasionKey(key)
                              setEnlargeFallbackTab({ visitCountAt: tab.visitCountAt, visitDate: tab.visitDate })
                            }}
                            style={{
                              flexShrink: 0, padding: '7px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                              whiteSpace: 'nowrap', cursor: 'pointer',
                              border: selected ? 'none' : `1px solid ${PALETTE.border}`,
                              background: selected ? PALETTE.gold : PALETTE.card,
                              color: selected ? '#FFFFFF' : PALETTE.muted,
                            }}
                          >
                            {tab.visitCountAt === 1 ? '初回' : `${tab.visitCountAt}回目`}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* 肌状態タグ(前回/今回それぞれの上位2項目) */}
              {(data.previousSkinTags.length > 0 || data.currentSkinTags.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
                  <SkinTagRow tags={data.previousSkinTags} />
                  <SkinTagRow tags={data.currentSkinTags} />
                </div>
              )}

              {/* 今回の施術 / 次回の目安 */}
              <div
                style={{
                  marginTop: '20px', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
                  borderRadius: '18px', boxShadow: PALETTE.shadow, display: 'flex', alignItems: 'stretch',
                }}
              >
                <InfoBarItem icon={Leaf} label="今回の施術" value={data.currentMenuName ?? '本日のメニューは準備中です'} />
                {/* SHOW_NEXT_VISIT_ESTIMATEがfalseの間は表示を一時停止する(2026-09-18ユーザー
                    承認、詳細はファイル冒頭のコメント参照)。既存のhiddenFromCustomer(顧客ごとの
                    個別設定)条件はそのまま維持し、両方を満たす場合のみ表示する。 */}
                {SHOW_NEXT_VISIT_ESTIMATE && !nextVisit.hiddenFromCustomer && (
                  <>
                    <div style={{ width: '1px', background: PALETTE.border }} />
                    <NextVisitInfoCell result={nextVisit.result} />
                  </>
                )}
              </div>
            </>
          )}

          {/* ── スクロール部分 ── */}
          {!data.loading && (
            <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* SHOW_HOMECAREがfalseの間は表示を一時停止する(2026-09-18ユーザー承認、
                  詳細はファイル冒頭のコメント参照)。 */}
              {SHOW_HOMECARE && data.homecareItems.length > 0 && (
                <Card title="今回のホームケア">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    {data.homecareItems.map(item => (
                      <div key={item.productName} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                            商品名
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
                            {item.productName}
                          </p>
                        </div>
                        {/* 2026-09-11: frequency/timingのラベルが入れ替わっていた表示バグを修正
                            (frequency=使用頻度・timing=使用タイミング。値自体は無変更)。 */}
                        {item.frequency && (
                          <div>
                            <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                              使用頻度
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: PALETTE.text, lineHeight: 1.6 }}>
                              {item.frequency}
                            </p>
                          </div>
                        )}
                        {item.timing && (
                          <div>
                            <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                              使用タイミング
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: PALETTE.text, lineHeight: 1.6 }}>
                              {item.timing}
                            </p>
                          </div>
                        )}
                        {item.caution && (
                          <div>
                            <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                              使用上の注意
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: PALETTE.text, lineHeight: 1.6 }}>
                              {item.caution}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* 過去の写真 — 現在選択中の角度タブに連動したサムネイル一覧(お客様用カルテ
                  再構成・2026-09-14)。タップすると既存の拡大モードでその回の写真を表示する。 */}
              {occasions.length > 0 && (
                <Card title="過去の写真">
                  <div
                    style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: '8px',
                    }}
                  >
                    {occasions.map(o => {
                      const photo = representativePhoto(o)
                      const url = data.photoUrls[photo.id] ?? thumbUrls[photo.id]
                      const active = enlargedActiveVisitId != null
                        ? photo.visitId === enlargedActiveVisitId
                        : o.key === enlargedOccasion?.key
                      const dateLabel = formatVisitDateLabel(photo.visitDate ?? photo.takenAt)
                      // キャプション(写真の下・PhotoPanel/EnlargedPhotoPanelと同じ「画像の外に表示」
                      // 方針に揃える)。既に取得済みのdateLabel/visitCountAtのみを使い、新規fetchは
                      // 行わない。日付が取れない場合のみ来店回数を代わりに出す。
                      const captionText = dateLabel
                        ?? (photo.visitCountAt != null ? (photo.visitCountAt === 1 ? '初回' : `${photo.visitCountAt}回目`) : null)
                      // 自由選択モード中のピン留め状態(1=1枚目・2=2枚目・null=未選択)。
                      const pinSlot: 1 | 2 | null =
                        photo.id === selectedPhotoA?.id ? 1 : photo.id === selectedPhotoB?.id ? 2 : null
                      const freeSelectActive = freeSelectMode && photoMode === 'compare'
                      return (
                        <div key={o.key}>
                          <button
                            type="button"
                            onClick={() => onThumbnailTap(o)}
                            aria-label={
                              freeSelectActive
                                ? (pinSlot ? `${dateLabel ?? ''}の写真の選択を解除` : `${dateLabel ?? ''}の写真を比較対象に選ぶ`)
                                : `${dateLabel ?? ''}の写真を拡大表示`
                            }
                            style={{
                              position: 'relative', aspectRatio: '1 / 1', borderRadius: '10px', overflow: 'hidden',
                              padding: 0, cursor: 'pointer', background: '#EFE8DA', width: '100%',
                              border: pinSlot
                                ? `2px solid ${PALETTE.gold}`
                                : (active && photoMode === 'enlarge' ? `2px solid ${PALETTE.gold}` : `1px solid ${PALETTE.border}`),
                            }}
                          >
                            {url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={url}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              />
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
                          {captionText && (
                            <p style={{ margin: '4px 0 0', fontSize: '10px', color: PALETTE.muted, textAlign: 'center' }}>
                              {captionText}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              {/* 来店履歴 */}
              {data.visits.length > 0 && (
                <Card title="来店履歴">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {data.visits.map((visit, i) => {
                      const visitNumber = data.visits.length - i
                      const dateLabel = formatVisitDateLabel(visit.visitDate)
                      return (
                        <div
                          key={visit.id}
                          style={{
                            display: 'flex', alignItems: 'baseline', gap: '10px',
                            padding: '10px 4px',
                            borderBottom: i < data.visits.length - 1 ? `1px solid ${PALETTE.border}` : 'none',
                          }}
                        >
                          <span style={{ fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>
                            来店{visitNumber}回目
                          </span>
                          <span style={{ fontSize: '12px', color: PALETTE.muted }}>
                            {[dateLabel, visit.menuName].filter(Boolean).join(' ・ ')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 拡大表示 ── */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(30,24,16,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px' }}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="閉じる"
            style={{
              position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', right: '24px',
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* スライダー比較(PhotoCompareScreen、2026-09-17導線変更)。撮影用ゴースト/ジャイロ画面
          (IpadPhotoCaptureModal.tsx)とは無関係。お客様に見せる画面としてこちら側に導線を
          集約した(スタッフ用カルテ側の同機能は削除済み)。 */}
      {sliderCompareOpen && (
        <PhotoCompareScreen
          customerId={customerId}
          initialBodyPart={angle}
          onClose={() => setSliderCompareOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * 「次回の目安」セル(PHASE NEXT-VISIT-1・2026-09-11)。次回目安エンジンの結果を
 * お客様向けに表示する。次回予約が既にある場合のみ具体的な日付(◯月◯日)を表示し、
 * それ以外は「約◯週間後」のみ(具体的な日付は出さない)。手動上書きは次回予約と
 * 同列には扱わない(あくまで目安のため、週数表示のまま)。
 */
function NextVisitInfoCell({ result }: { result: NextVisitResult | null }) {
  if (!result || !result.estimatedDate) {
    return <InfoBarItem icon={CalendarDays} label="次回の目安" value="ご来店後にご案内します" />
  }

  if (result.source === 'next_reservation') {
    return (
      <InfoBarItem
        icon={CalendarDays}
        label="次回のご予約"
        value={formatVisitDateLabel(result.estimatedDate) ?? 'ご来店後にご案内します'}
      />
    )
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(`${result.estimatedDate}T00:00:00`)
  const daysFromToday = Math.round((target.getTime() - today.getTime()) / 86_400_000)

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 20px' }}>
      <span
        style={{
          width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
          background: PALETTE.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <CalendarDays size={16} strokeWidth={1.4} color={PALETTE.gold} />
      </span>
      <div>
        <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.1em', color: PALETTE.muted }}>次回のお手入れ目安</p>
        <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
          {formatWeeksLabel(daysFromToday)}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '9px', color: PALETTE.muted, lineHeight: 1.4 }}>
          お肌の状態を見ながら、次回のお手入れ時期をご案内しています。
        </p>
      </div>
    </div>
  )
}

/** 比較｜拡大モードのショートカット切替ボタン(PHASE GUEST-MODE-3)。 */
function ShortcutButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
        cursor: 'pointer', whiteSpace: 'nowrap',
        border: active ? 'none' : `1px solid ${PALETTE.border}`,
        background: active ? PALETTE.gold : PALETTE.card,
        color: active ? '#FFFFFF' : PALETTE.muted,
      }}
    >
      {children}
    </button>
  )
}

/**
 * 拡大モードの単独写真表示(PHASE GUEST-MODE-3・2026-09-12)。二指ピンチでズーム、
 * ズーム中は一指ドラッグでpan、ダブルタップでリセットできる(usePinchZoom.ts参照)。
 *
 * 【重要】保留中の「比較エンジン(スライダー+連動ズーム)」とは別実装。ここでは1枚の
 * 写真を単独で拡大するだけで、2枚の写真を連動させてズーム・スライドする機能ではない。
 *
 * PhotoPanel(比較モードで使用・IpadStaffKarteViewとも共有)とは別コンポーネントとして
 * 新設する。PhotoPanelの見た目・挙動には一切手を入れない(iPadカルテ側への影響を避けるため)。
 */
function EnlargedPhotoPanel({
  url, loading, photo, fallbackTab,
}: {
  url: string | undefined
  loading: boolean
  photo: TimelinePhoto | null
  fallbackTab: { visitCountAt: number; visitDate: string | null } | null
}) {
  const zoom = usePinchZoom()

  useEffect(() => {
    zoom.reset()
    // urlが切り替わるたび(=表示中の回・角度が変わるたび)にズーム状態をリセットする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const visitCountAt = photo?.visitCountAt ?? fallbackTab?.visitCountAt ?? null
  const dateLabel = formatVisitDateLabel(photo?.visitDate ?? photo?.takenAt ?? fallbackTab?.visitDate ?? null)
  const captionParts = [
    visitCountAt != null ? `来店${visitCountAt}回目` : null,
    dateLabel,
  ].filter(Boolean)

  return (
    <div>
      <div
        style={{
          position: 'relative', aspectRatio: '4 / 5', borderRadius: '16px', overflow: 'hidden',
          background: '#EFE8DA', touchAction: 'none',
          border: url ? `1px solid ${PALETTE.border}` : `1.5px dashed ${PALETTE.border}`,
        }}
        onTouchStart={zoom.handlers.onTouchStart}
        onTouchMove={zoom.handlers.onTouchMove}
        onTouchEnd={zoom.handlers.onTouchEnd}
      >
        {loading && (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: PALETTE.muted, fontSize: '12px',
          }}>
            読み込み中…
          </div>
        )}
        {!loading && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="拡大写真"
            style={{
              width: '100%', height: '100%', objectFit: 'contain', display: 'block',
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
              transformOrigin: 'center',
              transition: zoom.scale === 1 ? 'transform 0.2s ease' : 'none',
            }}
          />
        )}
        {!loading && !url && (
          <div
            style={{
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px',
              alignItems: 'center', justifyContent: 'center',
              color: PALETTE.muted, fontSize: '12px', textAlign: 'center', padding: '16px',
            }}
          >
            <ImageOff size={26} strokeWidth={1.3} color={PALETTE.gold} />
            この回のこの角度の写真はありません
          </div>
        )}
      </div>
      {captionParts.length > 0 && (
        <p style={{ textAlign: 'center', margin: '10px 0 0', fontSize: '12px', color: PALETTE.muted }}>
          {captionParts.join(' ・ ')}{url ? '（ピンチで拡大できます）' : ''}
        </p>
      )}
    </div>
  )
}

// formatVisitDateLabel / PhotoPanel / SkinTagRow / InfoBarItem / Card は
// 2026-09-11、iPad専用スタッフカルテ画面(IpadStaffKarteView)との共有のため
// src/components/customer/shared/PhotoCompareKit.tsx へ移動した(ロジック・見た目は無変更)。

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
import { X, Leaf, CalendarDays, Flower2, ImageOff, SlidersHorizontal, Camera, ImagePlus, Trash2, Loader2 } from 'lucide-react'
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
} from '@/lib/photos/comparisonSelection'
import { getPhotoSignedUrl, getBatchSignedUrls, type TimelinePhoto } from '@/lib/photos/photoApiClient'
import { usePinchZoom } from './usePinchZoom'
import { useLongPress } from './useLongPress'
import PhotoCompareScreen from '@/components/customer/photoCompare/PhotoCompareScreen'
import PhotoDateHistory, { TodayPhotos } from './PhotoDateHistory'
// 写真撮影・選択・削除フロー(PHASE GUEST-MODE-PHOTO-MOVE-1・Phase 0・2026-09-19)。
// IpadStaffKarteView.tsxが使っていたものと同一のモーダル2つをそのまま再利用する
// (customerId/onClose等のpropsのみで完結する自己完結コンポーネントのため、呼び出し元を
// 追加するだけで済む。モーダル本体・内部の撮影/削除ロジックには一切手を加えていない)。
import IpadPhotoCaptureModal, { type PhotoCaptureIntent } from '@/components/customer/ipadKarte/IpadPhotoCaptureModal'
import IpadPhotoManageModal from '@/components/customer/ipadKarte/IpadPhotoManageModal'
// 担当者タグ選択(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)。写真登録が本画面に
// あるため必要(店舗共通ログイン時のみ意味を持つ表示専用コンポーネントで、顧客の業務データは
// 一切扱わないため、上記の「スタッフ専用コンポーネントは読み込まない」方針には抵触しない)。
import StaffTagBar from '@/components/customer/ipadKarte/StaffTagBar'
import { useStaffTagSession } from '@/lib/staffTag/useStaffTagSession'
import { useAuthStore } from '@/store/useAuthStore'
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants'
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
import FacialSchemaViewer from './FacialSchemaViewer'
import StaffPinModal from './StaffPinModal'
import { authedFetch } from '@/lib/api/authedFetch'
import { calculateAge } from '@/lib/customer/birthDate'

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

/**
 * 先読みしたdetail URLを再利用してよい期間。detailの署名付きURLの有効期限は60分
 * (SIGNED_URL_EXPIRY_DETAIL_SEC)のため、余裕を持って30分とする。
 */
const DETAIL_PRELOAD_REUSE_MS = 30 * 60 * 1000

interface Props {
  customerId: string
  customerName: string
  onClose: () => void
  /**
   * iPad専用カルテ入口(PHASE IPAD-KARTE-ENTRY-1・2026-09-20ユーザー承認)用の任意コールバック。
   * 指定時のみ、ヘッダー右側に「Staff Karte」ボタンを表示する。タップすると4桁PIN入力
   * モーダル(StaffPinModal)が開き、正しいPINを入力するとスタッフ用カルテへ切り替わる
   * (2026-09-22ユーザー承認: 従来のロゴ1000ms長押し→ロゴタップ→現在の明示的なボタン、
   * と改修を重ねてきた)。未指定時(CustomerBottomSheet経由の既存呼び出し)はボタン自体を
   * 描画せず、ロゴも非インタラクティブな装飾のまま。
   */
  onSwitchToStaffView?: () => void
  /**
   * お客様トップページ(CustomerTopPage.tsx)への導線用の任意コールバック
   * (2026-09-28ユーザー承認)。指定時のみ、ヘッダーに「お客様トップへ」ボタンを表示する。
   * 未指定時(CustomerBottomSheet経由の既存呼び出し)は何も表示しない
   * (CustomerTopPage自体が`/karte`専用領域のコンポーネントのため)。
   */
  onShowCustomerTop?: () => void
  /**
   * 「今回の施術」表示連携用の任意カウンタ(2026-09-28ユーザー承認)。値が変化するたびに
   * todayCourseOptions・todayOptionItems(メインコース・追加オプション)をまとめて
   * 再取得する。スタッフ用カルテでメインコース・追加オプションを選択・保存した後、
   * お客様用カルテへ切り替えたタイミングでKarteCustomerSwitcher.tsxがこの値を
   * インクリメントする想定(CustomerModeView自体は常時マウントのままのため、
   * 切り替えだけでは自動的に最新化されない)。未指定時(CustomerBottomSheet経由の
   * 既存呼び出し)は何もしない。
   */
  refreshCourseSignal?: number
}

/** ライトボックスの下部キャプション用。サムネイル一覧のcaptionTextと同じロジック
 *  (撮影日があれば日付、無ければ来店回数)。撮影メモは写真に紐づく項目が無いため
 *  表示対象外(カルテメモは別テーブル・別画面の情報のため、ここでは扱わない)。 */
function buildLightboxCaption(
  photo: { visitDate?: string | null; takenAt?: string | null; visitCountAt?: number | null } | null | undefined
): string | null {
  if (!photo) return null
  const dateLabel = formatVisitDateLabel(photo.visitDate ?? photo.takenAt ?? null)
  if (dateLabel) return dateLabel
  if (photo.visitCountAt != null) return photo.visitCountAt === 1 ? '初回' : `${photo.visitCountAt}回目`
  return null
}

export default function CustomerModeView({ customerId, customerName, onClose, onSwitchToStaffView, onShowCustomerTop, refreshCourseSignal }: Props) {
  const data = useCustomerModeData(customerId)

  // 「今回の施術」表示連携(2026-09-28ユーザー承認): refreshCourseSignalが変化した
  // タイミングでtodayCourseOptions・todayOptionItemsをまとめて再取得する(他の項目には
  // 触れない)。初回マウント時(通常のマウント時fetchで既に取得済み・refreshCourseSignal
  // 未指定=CustomerBottomSheet経由の既存呼び出し)は呼ばない。
  const courseSignalMountedRef = useRef(false)
  useEffect(() => {
    if (refreshCourseSignal === undefined) return
    if (!courseSignalMountedRef.current) {
      courseSignalMountedRef.current = true
      return
    }
    void data.refetchTodayCourseOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCourseSignal])
  const [angle, setAngle] = useState<CustomerModeAngleId>('face_front')
  /** ライトボックス表示中の写真。撮影日・来店回数のキャプションも合わせて保持する
   *  (2026-09-22ユーザー要望: 拡大表示にメタデータも表示する)。 */
  // photoId: 拡大中の写真のID。ZoomableLightboxImageのkeyに使い、別の写真に切り替わったときだけ
  // 再マウント(ズーム初期化)させ、同じ写真のサムネイル→高画質への差し替えでは再マウントしない。
  // preloaded: 高画質の先読み(下記detailPreloadRef)が完了済みで、差し替えなしで最初から表示できる。
  type LightboxState = { url: string; caption: string | null; photoId?: string | null; preloaded?: boolean }
  const [lightboxPhoto, setLightboxPhoto] = useState<LightboxState | null>(null)
  // 同日ギャラリーが開いている間に、ギャラリー内の写真の高画質(detail)URLを取得して先読みした
  // 結果(2026-10-01)。拡大タップ時に「サムネイル→高画質」の差し替えを起こさず、最初から高画質を
  // 即表示するため。<img>オブジェクトを保持してブラウザのキャッシュから追い出されにくくする
  // (iPadのメモリを圧迫しないよう、最大DETAIL_PRELOAD_MAX枚・古いものから破棄)。
  const detailPreloadRef = useRef<Map<string, { url: string; img: HTMLImageElement; at: number }>>(new Map())
  // openPhotoInLightbox()のdetail URL取得中に、拡大を閉じた/別の写真を開いた場合に、遅れて
  // 返ってきた結果で勝手に拡大表示が(再)出現しないようにするためのリクエスト番号。
  const lightboxReqRef = useRef(0)
  const showLightbox = (next: LightboxState) => {
    lightboxReqRef.current += 1
    setLightboxPhoto(next)
  }
  const closeLightbox = () => {
    lightboxReqRef.current += 1
    setLightboxPhoto(null)
  }
  // スクロール領域への参照。「過去の写真」サムネイルタップ時に拡大モードの表示(上部)まで
  // スクロールを戻すために使う(お客様用カルテ再構成・2026-09-14)。
  const scrollRef = useRef<HTMLDivElement>(null)

  // 「終了」ボタンの長押し化(誤操作防止・2026-09-20ユーザー承認)。お客様に見せている
  // 画面から誤タップでスタッフ専用画面(CustomerBottomSheet)へ戻ってしまうのを防ぐため、
  // 通常のタップでは閉じず600ms以上の長押しでのみonCloseを呼ぶ。
  const exitLongPress = useLongPress(onClose)

  // ロゴタップでスタッフ用カルテへ切替(2026-09-22ユーザー承認)。従来の1000ms長押し
  // (PHASE IPAD-KARTE-ENTRY-1)に代えて、4桁PIN入力モーダルを挟む方式に変更した。
  // onSwitchToStaffViewが未指定(CustomerBottomSheet経由の既存呼び出し)の場合はロゴに
  // ハンドラを一切付与せず、従来通りただの装飾テキストのまま(下のJSX側で分岐)。
  const [staffPinOpen, setStaffPinOpen] = useState(false)

  // 担当者タグ選択(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)。店舗共通ログイン
  // 時のみ意味を持つ(個人ログイン時はisSharedLoginがfalseになり無変更)。写真撮影・選択
  // 追加がこの画面にあるため、選択済みの担当者をIpadPhotoCaptureModalへ渡す必要がある。
  const isSharedLogin = useAuthStore(s => s.user?.id) === SHARED_IPAD_STAFF_USER_ID
  const staffTagSession = useStaffTagSession(isSharedLogin)

  // 次回目安エンジン(PHASE NEXT-VISIT-1・2026-09-11)。お客様モードでは具体的な日付は出さず、
  // 「約◯週間後」のみ表示する(次回予約が既にある場合のみ日付を表示)。
  const nextVisit = useNextVisit(customerId)

  // 年齢表示(2026-09-24ユーザー承認)。既存API(GET /api/customers/[id]、CustomerBottomSheet等が
  // 既に使っているもの)をこの画面専用に直接呼ぶ(customerModeData.tsは経由しない、
  // FacialSchemaViewer.tsxと同じ「自己完結fetch」パターン)。入力はCustomerTopPage.tsx側で
  // 行うため、この画面では表示のみ(読み取り専用)。
  const [age, setAge] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}`)
        if (res.ok) {
          const json = await res.json() as { customer?: { birthDate?: string | null } }
          const birthDate = json.customer?.birthDate ?? null
          if (!cancelled) setAge(birthDate ? calculateAge(birthDate) : null)
        }
      } catch {
        /* 取得失敗時は年齢欄を出さないまま(致命的にしない) */
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  const [compareBasis, setCompareBasis] = useState<ComparisonBasis>('previous')
  // スライダー比較(PhotoCompareScreen、2026-09-17導線変更): 撮影用ゴースト/ジャイロ画面
  // (IpadPhotoCaptureModal.tsx)とは無関係の、保存済み写真の閲覧専用モーダル。
  // お客様に見せる画面であるお客様モード側に導線を集約する(スタッフ用カルテからは削除済み)。
  const [sliderCompareOpen, setSliderCompareOpen] = useState(false)
  // 写真撮影・選択・削除フロー(PHASE GUEST-MODE-PHOTO-MOVE-1・Phase 0・2026-09-19)。
  // IpadStaffKarteView.tsxの同名stateと同じ役割・同じ型(モーダルの開閉のみを持つ)。
  const [photoCaptureIntent, setPhotoCaptureIntent] = useState<PhotoCaptureIntent | null>(null)
  const [photoManageOpen, setPhotoManageOpen] = useState(false)

  // 「今日撮影した写真」「過去の写真」(PhotoDateHistory.tsx)が取得したサムネイルURL。
  // ライトボックスを開くとき、高画質URLの取得が終わるまでの先行表示(cached)に使う。
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const onThumbsLoaded = (urls: Record<string, string>) => setThumbUrls(prev => ({ ...prev, ...urls }))
  const knownPhotoUrls = useMemo(() => ({ ...thumbUrls, ...data.photoUrls }), [thumbUrls, data.photoUrls])

  // 写真の自由選択比較(お客様用カルテ自由選択比較・2026-09-15・設計確定)。
  // 「前回↔今回」「初回↔今回」ショートカットとは独立した第3の選択肢で、来店回・角度を
  // 問わず任意の2枚を選べる。角度をまたいで選択を保持する必要があるため、下の
  // 角度切替リセットuseEffectの対象には含めない。
  const [freeSelectMode, setFreeSelectMode] = useState(false)
  const [selectedPhotoA, setSelectedPhotoA] = useState<TimelinePhoto | null>(null)
  const [selectedPhotoB, setSelectedPhotoB] = useState<TimelinePhoto | null>(null)

  // 角度切替時は比較の選択状態をリセットする(別の角度の撮影機会を参照し続けるのを防ぐ)。
  useEffect(() => {
    setCompareBasis('previous')
  }, [angle])

  const angleGroup: BodyPartPhotoGroup = useMemo(
    () => ({ bodyPart: angle, photos: data.photosByAngle[angle] ?? [] }),
    [angle, data.photosByAngle]
  )
  const occasions = useMemo(() => groupByOccasion(angleGroup.photos), [angleGroup])
  const isComparable = occasions.length >= 2
  const showFirstShortcut = hasDistinctFirstOccasion(angleGroup)

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

  /**
   * ギャラリー内(グリッド)の個別写真タップ: ライトボックス(ピンチズーム対応)で単独拡大表示する
   * (2026-09-20ユーザー承認のライトボックス機構をそのまま踏襲)。事前取得済み(photoUrls/
   * thumbUrls)のURLはサムネイル品質のことがあるため、無ければ'detail'品質のsigned URLを
   * 都度取得する。
   */
  async function openPhotoInLightbox(photo: TimelinePhoto) {
    const caption = buildLightboxCaption(photo)
    const cached = data.photoUrls[photo.id] ?? thumbUrls[photo.id]

    // 【2026-10-01改訂: 高画質の先読み】ギャラリーを開いた時点で高画質URLの先読みを始めている
    // (下のuseEffect)。有効期限内の先読み結果があれば、それを使う。
    const pre = detailPreloadRef.current.get(photo.id)
    const usablePre = pre && Date.now() - pre.at < DETAIL_PRELOAD_REUSE_MS ? pre : null
    if (usablePre && usablePre.img.complete && usablePre.img.naturalWidth > 0) {
      // 先読み完了済み: サムネイルを経由せず、最初から高画質を即表示する(差し替えが起きない)。
      showLightbox({ url: usablePre.url, caption, photoId: photo.id, preloaded: true })
      return
    }

    lightboxReqRef.current += 1
    const req = lightboxReqRef.current
    if (cached) setLightboxPhoto({ url: cached, caption, photoId: photo.id })
    // 先読みが未完了でも、取得済みのURLがあればそれを使う(API再取得を省く)。無ければ
    // 'detail'品質のURLを取得する。取得を試みている間、サムネイルが既にあればそれをフォール
    // バック表示し(読み込み中に真っ黒/空白にならないようにする)、取得できた時点で高画質URLへ
    // 差し替える。差し替えはZoomableLightboxImage側で「高画質の読み込みが完了するまでサムネイルを
    // 表示し続け、完了後に切り替える」ため、チラつかない(2026-10-01改訂)。
    const url = usablePre ? usablePre.url : await getPhotoSignedUrl(customerId, photo.id, 'detail')
    // 同じ描画のうちに高画質へ上書きするとサムネイルが一度も描画されないため、1フレーム待つ。
    if (usablePre && cached) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    // 取得中に拡大を閉じた・別の写真を開いた場合は、この結果を反映しない。
    if (req !== lightboxReqRef.current) return
    if (url) {
      setLightboxPhoto({ url, caption, photoId: photo.id })
    } else if (!cached) {
      // detail取得に失敗し、フォールバックできるサムネイルも無い場合は
      // モーダルを開かない(何も表示できないまま開いてしまうことを防ぐ)。
      setLightboxPhoto(null)
    }
  }

  /**
   * 比較対象へのピン留め/解除(先入れ先出し: 1枚目を追い出し、2枚目だった写真を
   * 1枚目へ繰り上げ、新しい写真を2枚目にすることで「常に直近タップした2枚」を維持する)。
   * 個別写真単位で動作するため、同一撮影機会(同日・同一visit)内の複数枚
   * (例: 施術前/施術後)からもそれぞれ独立に選べる(2026-09-28ユーザー承認、
   * 同日複数枚比較への選択ロジック拡張)。
   */
  /** 比較対象としての選択状態(1=1枚目・2=2枚目・null=未選択)。サムネイルの金枠+番号バッジ用。 */
  function pinSlotOf(photoId: string): 1 | 2 | null {
    return selectedPhotoA?.id === photoId ? 1 : selectedPhotoB?.id === photoId ? 2 : null
  }

  /** 操作メニューの「比較対象に設定」: 自由選択モードをONにした上で、既存のselectPhotoForCompareに渡す。 */
  function setAsCompareTarget(photo: TimelinePhoto) {
    setFreeSelectMode(true)
    selectPhotoForCompare(photo)
  }

  /**
   * 比較対象(1枚目/2枚目)からこの写真を外すだけ。自由選択モードの状態は変えない
   * (selectPhotoForCompareのトグル解除はモードをONにする経路でも呼ばれるため、
   * 「外す」専用にモードを触らない関数を分けた)。
   */
  function removeCompareTarget(photo: TimelinePhoto) {
    if (selectedPhotoA?.id === photo.id) setSelectedPhotoA(null)
    if (selectedPhotoB?.id === photo.id) setSelectedPhotoB(null)
  }

  function selectPhotoForCompare(photo: TimelinePhoto) {
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
          {/* ロゴは常に非インタラクティブな装飾のまま(2026-09-22ユーザー承認で、スタッフ用
              カルテへの切替トリガーをロゴタップから右側の明示的な「Staff Karte」ボタンへ
              移した。見つけにくいロゴタップより、はっきりラベル付きのボタンの方が
              分かりやすいため)。 */}
          <div style={{ display: 'inline-block' }}>
            <p
              style={{
                margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '20px', letterSpacing: '0.01em',
                color: PALETTE.gold,
                fontFamily: logoFont.style.fontFamily,
              }}
            >
              <Flower2 size={16} strokeWidth={1.4} color={PALETTE.gold} />
              Salon Riora
            </p>
          </div>
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
          {/* スタッフ用カルテへの切替ボタン(2026-09-22ユーザー承認)。旧CustomerBottomSheet.tsx
              の「🗂 iPadカルテ(β)」ボタンと同じ位置づけ(スタッフ向けの明示的な切替導線)だが、
              こちらはお客様に見えている画面上にあるため英語表記「Staff Karte」にし、タップで
              直接切り替わらず4桁PIN入力モーダル(StaffPinModal)を挟む。onSwitchToStaffView
              未指定時(CustomerBottomSheet経由の既存呼び出し)は描画しない。 */}
          {onSwitchToStaffView && (
            <button
              type="button"
              onClick={() => setStaffPinOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 14px', borderRadius: '999px', cursor: 'pointer',
                border: `1px solid ${PALETTE.gold}`, background: 'transparent', color: PALETTE.gold,
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              Staff Karte
            </button>
          )}
          {/* お客様トップページへの導線(2026-09-28ユーザー承認)。onShowCustomerTop未指定時
              (CustomerBottomSheet経由の既存呼び出し)は何も表示しない。 */}
          {onShowCustomerTop && (
            <button
              type="button"
              onClick={onShowCustomerTop}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 14px', borderRadius: '999px', cursor: 'pointer',
                border: `1px solid ${PALETTE.border}`, background: 'transparent', color: PALETTE.text,
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              お客様トップへ
            </button>
          )}
          <StaffTagBar
            isSharedLogin={isSharedLogin}
            tag={staffTagSession.tag}
            needsPrompt={staffTagSession.needsPrompt}
            onSelect={staffTagSession.setTag}
            onRequestChange={staffTagSession.clearTag}
          />
          <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted, whiteSpace: 'nowrap' }}>
            {customerName}様{age !== null ? `（${age}歳）` : ''}
          </p>
          {/* 「終了」ボタンの長押し化(誤操作防止・2026-09-20ユーザー承認)。押している間は
              リングで進捗を可視化し、下に常時ヒントを添えて「タップでは閉じない」ことを
              あらかじめ分かるようにする。 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ position: 'relative', width: '52px', height: '52px', flexShrink: 0 }}>
              {exitLongPress.pressing && (
                <svg
                  width="60" height="60" viewBox="0 0 60 60"
                  style={{ position: 'absolute', top: '-4px', left: '-4px', transform: 'rotate(-90deg)', pointerEvents: 'none' }}
                >
                  <circle
                    cx="30" cy="30" r="27" fill="none" stroke={PALETTE.gold} strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 27}
                    strokeDashoffset={2 * Math.PI * 27 * (1 - exitLongPress.progress)}
                  />
                </svg>
              )}
              <button
                type="button"
                {...exitLongPress.handlers}
                aria-label="長押しして終了"
                style={{
                  width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
                  background: exitLongPress.pressing ? PALETTE.gold : PALETTE.card,
                  border: `1.5px solid ${PALETTE.gold}`,
                  color: exitLongPress.pressing ? '#FFFFFF' : PALETTE.text,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  touchAction: 'none',
                }}
              >
                <X size={22} strokeWidth={2.2} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '9px', letterSpacing: '0.04em', color: PALETTE.muted, whiteSpace: 'nowrap' }}>
              長押しで終了
            </p>
          </div>
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
              {/* 比較モード常時表示 + ショートカット(拡大モード廃止・2026-09-20ユーザー承認:
                  「比較｜拡大」セグメンテッドコントロールを削除し、比較モードを唯一の表示
                  モードにした。写真のピンチズームはライトボックス(下部、拡大表示)側で行う)。 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* スライダー比較(PhotoCompareScreen、2026-09-17導線変更)。独立した別モーダルとして
                      開く(既存のPhotoPanel・自由選択比較には手を加えない)。 */}
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
              </div>

              {/* 自由選択の状態表示(お客様用カルテ自由選択比較・2026-09-15)。2枚揃うまでの
                  案内と、選び直すためのクリア導線。 */}
              {freeSelectMode && (
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

              {/* 写真表示: 比較モード常時表示(2枚並び・拡大モード廃止・2026-09-20ユーザー承認)。
                  PhotoPanel自体はobjectFit:containのため写真が見切れることは無いが、比較モードの
                  aspectRatioは既定値('5 / 4'・横長寄り)のままだと縦長の顔写真との差が大きく余白が
                  目立つため、実際の撮影写真に近い縦長比('4 / 5')を指定して余白を減らす。
                  IpadStaffKarteView側のPhotoPanel呼び出しはaspectRatio未指定のまま(既定値
                  '5 / 4')のため、この指定による影響はない。自由選択モード中は左=1枚目(A)・
                  右=2枚目(B)を選んだ順で固定表示する(leftPhoto/rightPhoto等を参照)。タップすると
                  ピンチズーム対応のライトボックス(下部)で拡大表示する。 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <PhotoPanel
                  label={leftLabel}
                  url={leftUrl}
                  visitCountAt={leftPhoto?.visitCountAt ?? null}
                  visitDate={leftPhoto?.visitDate ?? leftPhoto?.takenAt ?? null}
                  emptyText={leftEmptyText}
                  onExpand={leftUrl ? () => showLightbox({ url: leftUrl, caption: buildLightboxCaption(leftPhoto), photoId: leftPhoto?.id }) : undefined}
                  aspectRatio="4 / 5"
                />
                <PhotoPanel
                  label={rightLabel}
                  url={rightUrl}
                  visitCountAt={rightPhoto?.visitCountAt ?? null}
                  visitDate={rightPhoto?.visitDate ?? rightPhoto?.takenAt ?? null}
                  emptyText={rightEmptyText}
                  onExpand={rightUrl ? () => showLightbox({ url: rightUrl, caption: buildLightboxCaption(rightPhoto), photoId: rightPhoto?.id }) : undefined}
                  aspectRatio="4 / 5"
                />
              </div>

              {/* 今日撮影した写真: 大きな比較写真の直下に、今日(JST)撮影した写真を横並びで全部表示。
                  今日の写真が無ければ何も表示しない。タップは既存のライトボックス。 */}
              <TodayPhotos
                customerId={customerId}
                photos={data.allPhotos}
                knownUrls={knownPhotoUrls}
                onThumbsLoaded={onThumbsLoaded}
                freeSelectMode={freeSelectMode}
                pinSlotOf={pinSlotOf}
                onOpenPhoto={photo => { void openPhotoInLightbox(photo) }}
                onSelectForCompare={selectPhotoForCompare}
                onStartFreeSelect={() => setFreeSelectMode(true)}
                onSetCompareTarget={setAsCompareTarget}
                onRemoveCompareTarget={removeCompareTarget}
              />

              {/* 写真撮影・選択・削除(PHASE GUEST-MODE-PHOTO-MOVE-1・Phase 0・2026-09-19)。
                  IpadStaffKarteView.tsxの「写真カルテ」セクションにあった3ボタンと同じ
                  モーダル・同じonSaved/onDeletedの再取得方針(data.refetchPhotos)をそのまま
                  お客様モード側に新設する。 */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => setPhotoCaptureIntent('camera')}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '12px', borderRadius: '10px', border: `1.5px solid ${PALETTE.gold}`,
                    background: 'none', color: PALETTE.text, fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  <Camera size={16} strokeWidth={1.8} color={PALETTE.gold} />
                  撮影する
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoCaptureIntent('picker')}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '12px', borderRadius: '10px', border: `1.5px solid ${PALETTE.border}`,
                    background: 'none', color: PALETTE.text, fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  <ImagePlus size={16} strokeWidth={1.8} color={PALETTE.gold} />
                  選択して追加
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPhotoManageOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  width: '100%', marginTop: '10px', padding: '10px', borderRadius: '10px',
                  border: 'none', background: 'none', color: PALETTE.muted, fontSize: '12px', cursor: 'pointer',
                }}
              >
                <Trash2 size={14} strokeWidth={1.8} color={PALETTE.muted} />
                写真を削除
              </button>

              {/* 肌状態タグ(前回/今回それぞれの上位2項目) */}
              {(data.previousSkinTags.length > 0 || data.currentSkinTags.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
                  <SkinTagRow tags={data.previousSkinTags} />
                  <SkinTagRow tags={data.currentSkinTags} />
                </div>
              )}

              {/* 過去の写真(撮影日チップ → その日の写真を全部表示)。写真の撮影・追加・削除ボタンの
                  下、「今回の施術」の上。全角度(旧データ含む)の写真をtaken_atのJST日付でまとめる。
                  タップは既存のライトボックス(openPhotoInLightbox)をそのまま使う。 */}
              <PhotoDateHistory
                customerId={customerId}
                photos={data.allPhotos}
                knownUrls={knownPhotoUrls}
                onThumbsLoaded={onThumbsLoaded}
                freeSelectMode={freeSelectMode}
                pinSlotOf={pinSlotOf}
                onOpenPhoto={photo => { void openPhotoInLightbox(photo) }}
                onSelectForCompare={selectPhotoForCompare}
                onStartFreeSelect={() => setFreeSelectMode(true)}
                onSetCompareTarget={setAsCompareTarget}
                onRemoveCompareTarget={removeCompareTarget}
              />

              {/* 今回の施術 / 次回の目安 */}
              <div
                style={{
                  marginTop: '20px', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
                  borderRadius: '18px', boxShadow: PALETTE.shadow, display: 'flex', alignItems: 'stretch',
                }}
              >
                {/* 「今回の施術」表示連携(2026-09-28ユーザー承認): スタッフ用カルテで
                    保存したcourse_options(メインコース)・option_items(追加オプション)を
                    それぞれ明確に区別して表示する。どちらも無ければ従来通り
                    currentMenuName(来店メニュー名)へフォールバックする。共有InfoBarItem
                    はvalue:stringの単一行のみを想定しているため(「次回の目安」でも
                    共用しているため無変更)、この2行表示は同じ見た目パターンをここに
                    直接複製している。 */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 20px' }}>
                  <span
                    style={{
                      width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                      background: PALETTE.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Leaf size={16} strokeWidth={1.4} color={PALETTE.gold} />
                  </span>
                  <div>
                    <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.1em', color: PALETTE.muted }}>今回の施術</p>
                    {data.todayCourseOptions.length > 0 || data.todayOptionItems.length > 0 ? (
                      <>
                        {data.todayCourseOptions.length > 0 && (
                          <p style={{ margin: '2px 0 0', fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>
                            メインコース: {data.todayCourseOptions.join('・')}
                          </p>
                        )}
                        {data.todayOptionItems.length > 0 && (
                          <p style={{ margin: '2px 0 0', fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>
                            追加オプション: {data.todayOptionItems.join('・')}
                          </p>
                        )}
                      </>
                    ) : (
                      <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
                        {data.currentMenuName ?? '本日のメニューは準備中です'}
                      </p>
                    )}
                  </div>
                </div>
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

              {/* 顔シェーマ(顔シェーマ機能READ ONLY設計・Phase 0、2026-09-21ユーザー承認・Phase 6)。
                  読み取り専用。記録が無い顧客にはカード自体を出さない(過去の写真/来店履歴と同じ方針、
                  判定はFacialSchemaViewer内部で行う)。 */}
              <FacialSchemaViewer customerId={customerId} />

              {/* 来店履歴一覧は非表示化(2026-09-27ユーザー承認)。お客様モードではビフォーアフター
                  写真・写真カルテをスッキリ見せるため、この一覧セクションはレンダリングしない。
                  data.visits自体の取得(useCustomerModeData)は他の表示(次回目安等)にも使われて
                  いるため、フェッチ処理には手を加えていない。 */}
            </div>
          )}
        </div>
      </div>

      {/* ── 拡大表示(ピンチズーム対応、拡大モード廃止・2026-09-20ユーザー承認)。
          2026-09-22ユーザー要望により、撮影日等のキャプション表示と読み込み中/
          失敗時のフォールバックを追加(いずれも既存のタップ→起動・背景タップ/×で閉じる
          という導線自体には手を加えていない、表示内容の拡充のみ)。 ── */}
      {lightboxPhoto && (
        <div
          onClick={closeLightbox}
          style={{
            position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(30,24,16,0.85)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px',
          }}
        >
          {/* 画像自体へのタップはズーム操作(ピンチ/ダブルタップ)のため、背景への
              クリックとして閉じてしまわないようstopPropagationする。 */}
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <ZoomableLightboxImage key={lightboxPhoto.photoId ?? lightboxPhoto.url} url={lightboxPhoto.url} preloaded={lightboxPhoto.preloaded} />
            {lightboxPhoto.caption && (
              <span style={{
                fontSize: '13px', fontWeight: 700, color: '#fff',
                background: 'rgba(255,255,255,0.15)', padding: '6px 16px', borderRadius: '999px',
              }}>
                {lightboxPhoto.caption}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeLightbox}
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

      {/* 撮影・追加モーダル(PHASE GUEST-MODE-PHOTO-MOVE-1・Phase 0・2026-09-19)。
          IpadStaffKarteView.tsxと同じコンポーネント・同じprops構成をそのまま使う。 */}
      {photoCaptureIntent && (
        <IpadPhotoCaptureModal
          customerId={customerId}
          visitId={data.todayVisitId}
          intent={photoCaptureIntent}
          onClose={() => setPhotoCaptureIntent(null)}
          onSaved={() => { void data.refetchPhotos() }}
          staffId={isSharedLogin ? staffTagSession.tag?.id ?? null : null}
        />
      )}

      {/* 写真削除モーダル(PHASE GUEST-MODE-PHOTO-MOVE-1・Phase 0・2026-09-19)。
          IpadStaffKarteView.tsxと同じコンポーネント・同じprops構成をそのまま使う。 */}
      {photoManageOpen && (
        <IpadPhotoManageModal
          customerId={customerId}
          onClose={() => setPhotoManageOpen(false)}
          onDeleted={() => { void data.refetchPhotos() }}
        />
      )}

      {/* スタッフ用カルテ切替PIN(2026-09-22ユーザー承認)。ロゴタップで開く。onSwitchToStaffView
          未指定時はロゴにonClickが付与されないためstaffPinOpenは常にfalseのまま。 */}
      {staffPinOpen && (
        <StaffPinModal
          onSuccess={() => { setStaffPinOpen(false); onSwitchToStaffView?.() }}
          onClose={() => setStaffPinOpen(false)}
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

/** 比較モードのショートカット切替ボタン(PHASE GUEST-MODE-3)。 */
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
 * ライトボックス内の拡大写真(拡大モード廃止・比較モード常時表示化・2026-09-20ユーザー承認)。
 * 二指ピンチでズーム、ズーム中は一指ドラッグでpan、ダブルタップでリセットできる
 * (usePinchZoom.ts参照)。旧EnlargedPhotoPanel(拡大モード専用の単独写真表示)が持っていた
 * ピンチズーム機構をそのままライトボックスへ移設したもの(ズームの実装自体は無変更)。
 *
 * 【重要】保留中の「比較エンジン(スライダー+連動ズーム)」とは別実装。ここでは1枚の
 * 写真を単独で拡大するだけで、2枚の写真を連動させてズーム・スライドする機能ではない。
 */
function ZoomableLightboxImage({ url, preloaded = false }: { url: string; preloaded?: boolean }) {
  const zoom = usePinchZoom()
  // 読み込み中/失敗時のフォールバック表示(2026-09-22ユーザー要望)。
  //
  // 【2026-10-01改訂: 拡大時のチラつき解消】従来はurlが変わるたびに表示中の<img>を
  // display:none+スピナーに戻していたため、openPhotoInLightbox()が「まずサムネイルを表示→
  // detail品質のsigned URLを取得できたら差し替える」動きをすると、サムネイルが一瞬消えて
  // スピナーが出てから高画質画像が現れ、リロードのようにチラついていた(別URLのため
  // ブラウザキャッシュも効かない)。現在は「表示中のURL(shownUrl)」を保持したまま、新しいurlを
  // 画面外の<img>で先読みし、読み込み完了した時点で初めて表示を差し替える
  // (サムネイル→高画質が途切れずに切り替わる)。別の写真への切替はkey(photoId)で再マウント
  // される前提のため、ここではズーム状態を維持する(高画質化の差し替えでズームが戻らない)。
  // preloaded: 呼び出し側で先読み完了を確認済みの場合は、読み込み待ち(スピナー)を経由せず
  // 最初から表示する(ブラウザのキャッシュ済みのため即描画される)。
  const [shownUrl, setShownUrl] = useState<string | null>(preloaded ? url : null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  // 差し替え先のurlが読み込めなくても、既に表示できている画像(サムネイル等)があれば
  // それを表示し続ける。何も表示できていない場合のみ「読み込めませんでした」を出す。
  const status: 'loading' | 'loaded' | 'error' =
    shownUrl !== null ? 'loaded' : failedUrl === url ? 'error' : 'loading'

  return (
    <div
      style={{ width: '100%', height: '100%', touchAction: 'none', position: 'relative', minWidth: '120px', minHeight: '120px' }}
      onTouchStart={zoom.handlers.onTouchStart}
      onTouchMove={zoom.handlers.onTouchMove}
      onTouchEnd={zoom.handlers.onTouchEnd}
    >
      {status !== 'loaded' && (
        <div style={{
          position: status === 'loading' ? 'absolute' : 'static', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '8px', color: 'rgba(255,255,255,0.85)', padding: '40px',
        }}>
          {status === 'loading' ? (
            <Loader2 size={28} className="animate-spin" />
          ) : (
            <>
              <ImageOff size={28} />
              <span style={{ fontSize: '13px' }}>画像を読み込めませんでした</span>
            </>
          )}
        </div>
      )}
      {/* 先読み用(画面外・非表示): 新しいurlはここで読み込み、完了したらshownUrlへ差し替える。
          shownUrlと同じurlのときは不要。読み込み済みのためブラウザが再取得せず即表示できる。 */}
      {url !== shownUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          aria-hidden="true"
          onLoad={() => { setShownUrl(url); setFailedUrl(null) }}
          onError={() => setFailedUrl(url)}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}
      {shownUrl !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shownUrl}
          alt=""
          style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px',
            display: 'block', margin: '0 auto',
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            transformOrigin: 'center',
            transition: zoom.scale === 1 ? 'transform 0.2s ease' : 'none',
          }}
        />
      )}
    </div>
  )
}

// formatVisitDateLabel / PhotoPanel / SkinTagRow / InfoBarItem / Card は
// 2026-09-11、iPad専用スタッフカルテ画面(IpadStaffKarteView)との共有のため
// src/components/customer/shared/PhotoCompareKit.tsx へ移動した(ロジック・見た目は無変更)。

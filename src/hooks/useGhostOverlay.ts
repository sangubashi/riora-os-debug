'use client'
/**
 * useGhostOverlay.ts — 写真カルテ Phase 2(ゴースト機能: 前回写真の半透明重ね表示)。
 *
 * 自動選択(前回/初回)自体はusePhotoCapture.tsの既存ロジック(ghostSelection.ts経由)を
 * そのまま使い、このフックはUIから必要な「ON/OFF」「強さ(連続%)」「日付を手動で選び直す」
 * を追加するだけの上乗せレイヤーとして実装する(usePhotoCapture.ts・captureConfirmFlow.ts
 * ・ghostSelection.ts本体には一切手を加えない)。
 *
 * 日付の手動選択(候補一覧)は既存の GET /api/customers/[id]/photos をそのまま使う
 * (photoApiClient.tsのcreatePhotoListFetcher()、新規APIは追加しない)。
 */
import { useCallback, useEffect, useState } from 'react'
import { createPhotoListFetcher, getPhotoSignedUrl } from '@/lib/photos/photoApiClient'
import type { GhostCandidatePhoto, GhostPhotoResult } from '@/lib/photos/ghostSelection'

const GHOST_ENABLED_STORAGE_KEY = 'riora.photoKarte.ghostEnabled'
const GHOST_OPACITY_STORAGE_KEY = 'riora.photoKarte.ghostOpacityPercent'

/** ゴーストの初期不透明度(%)。デザイン確定値(IMG_1448.JPG)。 */
export const GHOST_DEFAULT_OPACITY_PERCENT = 30
/** 日付候補一覧の取得件数上限。Phase1の他一覧取得(limit 5等)より広めに取る暫定値。 */
const GHOST_CANDIDATE_LIMIT = 20

export interface UseGhostOverlayOptions {
  customerId: string
  bodyPart: string
  currentVisitId: string | null
  /** usePhotoCaptureが既に算出している自動選択(前回優先→初回)の結果。 */
  autoGhost: GhostPhotoResult | null
  autoGhostUrl: string | null
}

export interface UseGhostOverlayResult {
  enabled: boolean
  setEnabled: (v: boolean) => void
  /** 0-100の整数。 */
  opacityPercent: number
  setOpacityPercent: (v: number) => void
  /** 日付選択リスト用の候補(同一bodyPart・当日visitを除く、taken_at降順)。 */
  candidates: GhostCandidatePhoto[]
  candidatesLoading: boolean
  /** nullの場合は自動選択(前回/初回)に従う。 */
  selectedPhotoId: string | null
  selectPhoto: (photoId: string | null) => void
  /** 実際に重ねて表示すべき写真(手動選択があればそれ、無ければ自動選択)。 */
  activePhoto: GhostCandidatePhoto | null
  activeUrl: string | null
  activeUrlLoading: boolean
}

function readStoredOpacity(): number {
  try {
    const raw = window.localStorage.getItem(GHOST_OPACITY_STORAGE_KEY)
    const n = raw === null ? NaN : Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n
  } catch {
    // localStorage不可の環境(プライベートモード等)は既定値のまま進める
  }
  return GHOST_DEFAULT_OPACITY_PERCENT
}

function readStoredEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(GHOST_ENABLED_STORAGE_KEY)
    if (raw !== null) return raw === '1'
  } catch {
    // 同上
  }
  return true
}

/** 「2026/03/15 (3週間前)」形式の表示ラベルを組み立てる(IMG_1448.JPGの表記に合わせる)。 */
export function formatGhostDateLabel(takenAt: string): string {
  const date = new Date(takenAt)
  if (Number.isNaN(date.getTime())) return takenAt

  const dateLabel = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`

  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  let relative: string
  if (diffDays === 0) relative = '今日'
  else if (diffDays < 7) relative = `${diffDays}日前`
  else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}週間前`
  else relative = `${Math.floor(diffDays / 30)}ヶ月前`

  return `${dateLabel} (${relative})`
}

export function useGhostOverlay({
  customerId,
  bodyPart,
  currentVisitId,
  autoGhost,
  autoGhostUrl,
}: UseGhostOverlayOptions): UseGhostOverlayResult {
  const [enabled, setEnabledState] = useState(true)
  const [opacityPercent, setOpacityPercentState] = useState(GHOST_DEFAULT_OPACITY_PERCENT)
  const [candidates, setCandidates] = useState<GhostCandidatePhoto[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)
  const [overrideUrl, setOverrideUrl] = useState<string | null>(null)
  const [overrideUrlLoading, setOverrideUrlLoading] = useState(false)

  // 直前に選んだON/OFF・強さをlocalStorageから復元(usePhotoCapture.tsのghostOpacityLevel
  // 復元と同じパターン。失敗しても既定値のまま進める)。
  useEffect(() => {
    setEnabledState(readStoredEnabled())
    setOpacityPercentState(readStoredOpacity())
  }, [])

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    try {
      window.localStorage.setItem(GHOST_ENABLED_STORAGE_KEY, v ? '1' : '0')
    } catch {
      // 保存できなくても致命的ではない
    }
  }, [])

  const setOpacityPercent = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)))
    setOpacityPercentState(clamped)
    try {
      window.localStorage.setItem(GHOST_OPACITY_STORAGE_KEY, String(clamped))
    } catch {
      // 同上
    }
  }, [])

  // 部位が変わるたびに日付候補一覧を再取得し、手動選択はリセットする
  // (別の部位に切り替えたのに前の部位の手動選択が残ると混乱するため)。
  useEffect(() => {
    setSelectedPhotoId(null)
    setOverrideUrl(null)

    if (!bodyPart) {
      setCandidates([])
      return undefined
    }

    let cancelled = false
    setCandidatesLoading(true)
    const fetcher = createPhotoListFetcher(customerId)

    fetcher
      .listPhotos({ customerId, bodyPart, order: 'desc', limit: GHOST_CANDIDATE_LIMIT })
      .then(photos => {
        if (cancelled) return
        setCandidates(photos.filter(p => p.visitId !== currentVisitId))
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [customerId, bodyPart, currentVisitId])

  const selectPhoto = useCallback((photoId: string | null) => {
    setSelectedPhotoId(photoId)
  }, [])

  // 手動選択されたら、その写真の署名URLを別途取得する(自動選択のURLはusePhotoCapture側で
  // 既に取得済みのautoGhostUrlをそのまま使い、二重取得しない)。
  useEffect(() => {
    if (!selectedPhotoId) {
      setOverrideUrl(null)
      return undefined
    }

    let cancelled = false
    setOverrideUrlLoading(true)
    getPhotoSignedUrl(customerId, selectedPhotoId, 'detail')
      .then(url => {
        if (!cancelled) setOverrideUrl(url)
      })
      .catch(() => {
        if (!cancelled) setOverrideUrl(null)
      })
      .finally(() => {
        if (!cancelled) setOverrideUrlLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [customerId, selectedPhotoId])

  const activePhoto: GhostCandidatePhoto | null = selectedPhotoId
    ? candidates.find(c => c.id === selectedPhotoId) ?? null
    : autoGhost?.photo ?? null
  const activeUrl = selectedPhotoId ? overrideUrl : autoGhostUrl
  const activeUrlLoading = selectedPhotoId ? overrideUrlLoading : false

  return {
    enabled,
    setEnabled,
    opacityPercent,
    setOpacityPercent,
    candidates,
    candidatesLoading,
    selectedPhotoId,
    selectPhoto,
    activePhoto,
    activeUrl,
    activeUrlLoading,
  }
}

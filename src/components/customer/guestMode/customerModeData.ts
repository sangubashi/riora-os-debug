'use client'
/**
 * customerModeData.ts — 「お客様モード」画面(CustomerModeView)専用のデータ取得ロジック。
 *
 * PHASE GUEST-MODE-1(2026-09-10・iPadお客様モード新設)。
 *
 * 既存API・既存ロジックのみを呼び出す(新規API・新規DBアクセス・新規テーブルは一切追加しない)。
 * 取得先はいずれもスタッフ画面(CustomerBottomSheet)や見る側コンポーネント
 * (SkinConditionViewSection/TreatmentRecordViewSection/GoalSection等)が既に使っている
 * ものと完全に同一:
 *   - GET /api/customers/[id]/visit-history
 *   - GET /api/customers/[id]/skin-records
 *   - GET /api/customers/[id]/goal
 *   - GET /api/customers/[id]/homecare-products
 *   - GET /api/customers/[id]/visits/[visitId]/treatment
 *   - 写真カルテAPI(src/lib/photos/photoApiClient.ts・src/lib/photos/comparisonSelection.ts)
 *
 * お客様モードは CustomerBottomSheet の state を一切共有しない、完全に自己完結した
 * コンポーネントとして設計する(GoalSection等と同じ「customerIdを受け取り自前でfetchする」
 * パターンをそのまま踏襲)。これによりスタッフ画面側の巨大なstate/useEffectには一切
 * 手を入れず、かつスタッフ専用情報(禁忌・売上・引き継ぎ・AI提案・NGワード等)を扱う
 * コンポーネント/モジュールを一切importしない設計にできる — お客様モードでは
 * これらのモジュール自体がロードされないため、CSSで隠すだけの実装より安全側になる。
 *
 * 「今回の施術記録」(options/productsUsed)のうち治療メモ(treatmentMemo)は自由記述の
 * スタッフ向けメモであり、顧客に見せる前提で書かれていないため、お客様モードには
 * 意図的に含めない(options/productsUsedという定型項目のみを使う)。
 */
import { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'
import {
  listCustomerPhotosTimeline,
  getBatchSignedUrls,
  type TimelinePhoto,
} from '@/lib/photos/photoApiClient'
import {
  groupPhotosByBodyPart,
  comparableGroups,
  buildPreviousComparison,
} from '@/lib/photos/comparisonSelection'
import { getHomecareUsageGuide } from '@/lib/homecare/homecareUsageGuide'
import { getMenuCycleDays } from '@/lib/homecare/generateHomecarePlan'

export const CUSTOMER_MODE_ANGLES = [
  { id: 'face_front', label: '正面' },
  { id: 'face_left45', label: '左45°' },
  { id: 'face_right45', label: '右45°' },
] as const

export type CustomerModeAngleId = (typeof CUSTOMER_MODE_ANGLES)[number]['id']

export interface AnglePhotoPair {
  current: TimelinePhoto | null
  reference: TimelinePhoto | null
}

interface VisitHistoryEntry {
  id: string
  visitDate: string
  menuName: string | null
}

interface SkinRecord {
  visitId: string
  acneLevel: number | null
  poreLevel: number | null
  drynessLevel: number | null
  rednessLevel: number | null
  saggingLevel: number | null
  dullnessLevel: number | null
  firmnessLevel: number | null
}

const SKIN_LEVEL_META: Array<{ key: keyof Omit<SkinRecord, 'visitId'>; label: string; color: string }> = [
  { key: 'drynessLevel', label: '乾燥', color: '#7B93A8' },
  { key: 'poreLevel', label: '毛穴', color: '#C99A5B' },
  { key: 'rednessLevel', label: '赤み', color: '#D08A85' },
  { key: 'firmnessLevel', label: 'ハリ', color: '#B08D57' },
  { key: 'acneLevel', label: 'ニキビ', color: '#C97A6D' },
  { key: 'saggingLevel', label: 'たるみ', color: '#9B8A73' },
  { key: 'dullnessLevel', label: 'くすみ', color: '#A69784' },
]

export interface SkinTagChip {
  label: string
  color: string
}

/** レベルが1以上の項目を上位max件だけ抽出する(0/未記録の項目は表示しない)。 */
export function pickNotableSkinTags(record: SkinRecord | null, max = 2): SkinTagChip[] {
  if (!record) return []
  return SKIN_LEVEL_META
    .map(meta => ({ meta, value: record[meta.key] ?? 0 }))
    .filter(x => (x.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, max)
    .map(x => ({ label: x.meta.label, color: x.meta.color }))
}

interface HomecareProductEntry {
  productName: string
  purchaseCount: number
  lastPurchasedAt: string
}

export interface HomecareCardItem {
  productName: string
  frequency: string | null
  timing: string | null
}

interface TreatmentDetail {
  options: unknown
  productsUsed: unknown
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 指定body_partの「前回↔今回」ペアを組み立てる。撮影機会が1つしかない場合は
 * 「今回」のみ(前回なし)、写真が無ければ両方nullを返す。
 * 既存のcomparisonSelection.tsの公開関数のみを使い、比較ロジック自体は変更しない。
 */
function buildAngleComparison(photos: TimelinePhoto[], bodyPart: string): AnglePhotoPair {
  const groups = groupPhotosByBodyPart(photos)
  const group = groups.find(g => g.bodyPart === bodyPart)
  if (!group || group.photos.length === 0) return { current: null, reference: null }

  const comparable = comparableGroups([group])
  if (comparable.length > 0) {
    const pair = buildPreviousComparison(comparable[0])
    return { current: pair.current, reference: pair.reference }
  }
  return { current: group.photos[0], reference: null }
}

export interface CustomerModeData {
  loading: boolean
  anglePairs: Record<string, AnglePhotoPair>
  /** photoId → signed URL('detail'品質)。拡大表示にもそのまま流用する。 */
  photoUrls: Record<string, string>
  currentMenuName: string | null
  nextVisitLabel: string | null
  currentSkinTags: SkinTagChip[]
  previousSkinTags: SkinTagChip[]
  homecareItems: HomecareCardItem[]
  goalNote: string | null
  treatmentPoints: string[]
}

const EMPTY_DATA: CustomerModeData = {
  loading: true,
  anglePairs: {},
  photoUrls: {},
  currentMenuName: null,
  nextVisitLabel: null,
  currentSkinTags: [],
  previousSkinTags: [],
  homecareItems: [],
  goalNote: null,
  treatmentPoints: [],
}

export function useCustomerModeData(customerId: string): CustomerModeData {
  const [data, setData] = useState<CustomerModeData>(EMPTY_DATA)

  useEffect(() => {
    let cancelled = false
    setData(EMPTY_DATA)

    void (async () => {
      const todayStr = todayDateStr()

      const [photos, visitsJson, skinJson, goalJson, homecareJson] = await Promise.all([
        listCustomerPhotosTimeline(customerId),
        authedFetch(`/api/customers/${customerId}/visit-history`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch(`/api/customers/${customerId}/skin-records`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch(`/api/customers/${customerId}/goal`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch(`/api/customers/${customerId}/homecare-products`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (cancelled) return

      const visits: VisitHistoryEntry[] =
        (visitsJson?.success ? visitsJson.visits : []) ?? []
      const todayVisit = visits.find(v => v.visitDate === todayStr) ?? null
      const todayVisitId = todayVisit?.id ?? null
      const currentMenuName = todayVisit?.menuName ?? visits[0]?.menuName ?? null

      const records: SkinRecord[] = (skinJson?.success ? skinJson.records : []) ?? []
      const currentRecord = records.find(r => r.visitId === todayVisitId) ?? null
      const previousRecord = records.find(r => r.visitId !== todayVisitId) ?? null
      const currentSkinTags = pickNotableSkinTags(currentRecord)
      const previousSkinTags = pickNotableSkinTags(previousRecord)

      const homecareProducts: HomecareProductEntry[] =
        (homecareJson?.success ? homecareJson.products : []) ?? []
      const todaysProducts = homecareProducts.filter(p => p.lastPurchasedAt === todayStr)
      const pickedProducts = (todaysProducts.length > 0 ? todaysProducts : homecareProducts).slice(0, 3)
      const homecareItems: HomecareCardItem[] = pickedProducts.map(p => {
        const guide = getHomecareUsageGuide(p.productName)
        return { productName: p.productName, frequency: guide?.frequency ?? null, timing: guide?.timing ?? null }
      })

      const goalNote: string | null = goalJson?.success ? (goalJson.goalNote ?? null) : null

      let treatmentPoints: string[] = []
      if (todayVisitId) {
        try {
          const res = await authedFetch(`/api/customers/${customerId}/visits/${todayVisitId}/treatment`)
          if (res.ok) {
            const json = (await res.json()) as { success: boolean; treatment?: TreatmentDetail }
            if (json.success && json.treatment) {
              treatmentPoints = [
                ...toStringList(json.treatment.options),
                ...toStringList(json.treatment.productsUsed),
              ]
            }
          }
        } catch {
          /* 施術ポイントが無くても他の表示に影響させない */
        }
      }
      if (cancelled) return

      const anglePairs: Record<string, AnglePhotoPair> = {}
      for (const angle of CUSTOMER_MODE_ANGLES) {
        anglePairs[angle.id] = buildAngleComparison(photos, angle.id)
      }

      const photoIds = Object.values(anglePairs)
        .flatMap(p => [p.current?.id, p.reference?.id])
        .filter((id): id is string => !!id)
      const photoUrls = await getBatchSignedUrls(customerId, photoIds, 'detail')
      if (cancelled) return

      const cycleDays = currentMenuName ? getMenuCycleDays(currentMenuName) : null
      const careHint = currentSkinTags[0]?.label ?? previousSkinTags[0]?.label ?? null
      const nextVisitLabel = cycleDays
        ? `約${Math.max(1, Math.round(cycleDays / 7))}週間後${careHint ? `、${careHint}ケア` : ''}`
        : null

      setData({
        loading: false,
        anglePairs,
        photoUrls,
        currentMenuName,
        nextVisitLabel,
        currentSkinTags,
        previousSkinTags,
        homecareItems,
        goalNote,
        treatmentPoints,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [customerId])

  return data
}

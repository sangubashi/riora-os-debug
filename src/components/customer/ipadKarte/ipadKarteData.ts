'use client'
/**
 * ipadKarteData.ts — iPad専用スタッフカルテ画面(IpadStaffKarteView)専用のデータ取得ロジック。
 *
 * PHASE IPAD-1(2026-09-11・並行稼働の試験画面)。
 *
 * 既存API・既存ロジックのみを呼び出す(新規API・新規DBアクセス・新規テーブルは一切追加しない)。
 * customerModeData.ts(お客様モード)と同じ「customerIdを受け取り自前でfetchする」
 * 自己完結パターンを踏襲するが、こちらはスタッフ向け画面のため、お客様モードのような
 * 表示内容の除外・言い回しの加工は行わない(禁忌事項・目標は生データをそのまま返す)。
 *
 * customerModeData.ts自体は無変更(ロジック共有は写真系モジュールとpickNotableSkinTagsの
 * importのみで、お客様モードの挙動には一切影響しない)。
 *
 * 今回のスコープ(🟢項目のみ): 重要事項・目標・写真カルテ・肌タグ簡易版・次回の目安。
 * 「今日の施術」は手順テンプレート化せず、当日visitのoptions/productsUsedをそのまま返す
 * (🔴項目の手順テンプレートは今回見送り)。前回の施術・AI接客ポイント・次回提案は
 * 次フェーズ(🟡項目)のため、このフックには含めない。
 */
import { useCallback, useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'
import { fetchContraindications } from '@/lib/contraindication'
import type { Contraindication } from '@/types'
import { CONTRAINDICATION_SEVERITY_ORDER } from '@/types'
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
import { pickNotableSkinTags, type SkinTagChip } from '@/components/customer/guestMode/customerModeData'
import { getHomecareUsageGuide } from '@/lib/homecare/homecareUsageGuide'

export const IPAD_KARTE_ANGLES = [
  { id: 'face_front', label: '正面' },
  { id: 'face_left45', label: '左45°' },
  { id: 'face_right45', label: '右45°' },
] as const

export type IpadKarteAngleId = (typeof IPAD_KARTE_ANGLES)[number]['id']

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

interface TreatmentDetail {
  options: unknown
  productsUsed: unknown
}

interface HomecareProductEntry {
  productName: string
  purchaseCount: number
  lastPurchasedAt: string
}

/** 「今回のホームケア」カード用の1商品分(customerModeData.tsのHomecareCardItemと同じ形)。 */
export interface HomecareCardItem {
  productName: string
  frequency: string | null
  timing: string | null
  /** 使用上の注意(homecareUsageGuide.tsの既存cautionをそのまま渡すだけ・辞書自体は無変更)。 */
  caution: string | null
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 指定body_partの「前回↔今回」ペアを組み立てる(customerModeData.tsのbuildAngleComparisonと同一ロジック)。 */
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

export interface IpadKarteData {
  loading: boolean
  anglePairs: Record<string, AnglePhotoPair>
  photoUrls: Record<string, string>
  /** 重要度順(CRITICAL→LOW)に並べ替え済み。削除等の操作はこの画面では扱わない(閲覧のみ)。 */
  contraindications: Contraindication[]
  goalNote: string | null
  currentMenuName: string | null
  currentSkinTags: SkinTagChip[]
  /** 当日visitのoptions/productsUsedをそのまま返す(手順テンプレート化はしない)。 */
  todayTreatmentPoints: string[]
  // 「次回の目安」は次回目安エンジン(PHASE NEXT-VISIT-1・src/lib/nextVisit/useNextVisit.ts)に
  // 置き換えたため、このフックでは算出しない(IpadStaffKarteView側でuseNextVisitを直接使う)。
  /** 「今回のホームケア」カード(customerModeData.tsと同じ取得ロジックの流用)。 */
  homecareItems: HomecareCardItem[]
}

const EMPTY_DATA: IpadKarteData = {
  loading: true,
  anglePairs: {},
  photoUrls: {},
  contraindications: [],
  goalNote: null,
  currentMenuName: null,
  currentSkinTags: [],
  todayTreatmentPoints: [],
  homecareItems: [],
}

export interface UseIpadKarteDataResult extends IpadKarteData {
  /**
   * カルテ取込(KarteImportSection)保存後・目標編集(GoalEditCard)保存後に呼ぶ軽量な
   * 再取得(PHASE IPAD-5・IPAD-6・2026-09-12)。写真・スキンレコード等は再取得せず、
   * 重要事項・目標のみを更新する(全項目再取得は写真の signed URL 再発行等が走り重いため)。
   */
  refetchGoalAndContraindications: () => Promise<void>
}

export function useIpadKarteData(customerId: string): UseIpadKarteDataResult {
  const [data, setData] = useState<IpadKarteData>(EMPTY_DATA)

  useEffect(() => {
    let cancelled = false
    setData(EMPTY_DATA)

    void (async () => {
      const todayStr = todayDateStr()

      const [photos, visitsJson, skinJson, goalJson, contraindications, homecareJson] = await Promise.all([
        listCustomerPhotosTimeline(customerId),
        authedFetch(`/api/customers/${customerId}/visit-history`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch(`/api/customers/${customerId}/skin-records`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch(`/api/customers/${customerId}/goal`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetchContraindications(customerId),
        authedFetch(`/api/customers/${customerId}/homecare-products`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (cancelled) return

      const visits: VisitHistoryEntry[] =
        (visitsJson?.success ? visitsJson.visits : []) ?? []
      const todayVisit = visits.find(v => v.visitDate === todayStr) ?? null
      const todayVisitId = todayVisit?.id ?? null
      const latestVisit = todayVisit ?? visits[0] ?? null
      const currentMenuName = latestVisit?.menuName ?? null

      const records: SkinRecord[] = (skinJson?.success ? skinJson.records : []) ?? []
      const currentRecord = records.find(r => r.visitId === todayVisitId) ?? records[0] ?? null
      const currentSkinTags = pickNotableSkinTags(currentRecord, 5)

      const goalNote: string | null = goalJson?.success ? (goalJson.goalNote ?? null) : null

      // 「今回のホームケア」(customerModeData.tsのuseCustomerModeDataと同じロジック)。
      const homecareProducts: HomecareProductEntry[] =
        (homecareJson?.success ? homecareJson.products : []) ?? []
      const todaysProducts = homecareProducts.filter(p => p.lastPurchasedAt === todayStr)
      const pickedProducts = (todaysProducts.length > 0 ? todaysProducts : homecareProducts).slice(0, 3)
      const homecareItems: HomecareCardItem[] = pickedProducts.map(p => {
        const guide = getHomecareUsageGuide(p.productName)
        return { productName: p.productName, frequency: guide?.frequency ?? null, timing: guide?.timing ?? null, caution: guide?.caution ?? null }
      })

      const sortedContraindications = [...contraindications].sort(
        (a, b) => CONTRAINDICATION_SEVERITY_ORDER.indexOf(a.severity) - CONTRAINDICATION_SEVERITY_ORDER.indexOf(b.severity)
      )

      let todayTreatmentPoints: string[] = []
      if (todayVisitId) {
        try {
          const res = await authedFetch(`/api/customers/${customerId}/visits/${todayVisitId}/treatment`)
          if (res.ok) {
            const json = (await res.json()) as { success: boolean; treatment?: TreatmentDetail }
            if (json.success && json.treatment) {
              todayTreatmentPoints = [
                ...toStringList(json.treatment.options),
                ...toStringList(json.treatment.productsUsed),
              ]
            }
          }
        } catch {
          /* 今日の施術記録が無くても他の表示に影響させない */
        }
      }
      if (cancelled) return

      const anglePairs: Record<string, AnglePhotoPair> = {}
      for (const angle of IPAD_KARTE_ANGLES) {
        anglePairs[angle.id] = buildAngleComparison(photos, angle.id)
      }

      const photoIds = Object.values(anglePairs)
        .flatMap(p => [p.current?.id, p.reference?.id])
        .filter((id): id is string => !!id)
      const photoUrls = await getBatchSignedUrls(customerId, photoIds, 'detail')
      if (cancelled) return

      setData({
        loading: false,
        anglePairs,
        photoUrls,
        contraindications: sortedContraindications,
        goalNote,
        currentMenuName,
        currentSkinTags,
        todayTreatmentPoints,
        homecareItems,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [customerId])

  const refetchGoalAndContraindications = useCallback(async () => {
    const [goalJson, contraindications] = await Promise.all([
      authedFetch(`/api/customers/${customerId}/goal`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetchContraindications(customerId),
    ])
    const goalNote: string | null = goalJson?.success ? (goalJson.goalNote ?? null) : null
    const sortedContraindications = [...contraindications].sort(
      (a, b) => CONTRAINDICATION_SEVERITY_ORDER.indexOf(a.severity) - CONTRAINDICATION_SEVERITY_ORDER.indexOf(b.severity)
    )
    setData(prev => ({ ...prev, goalNote, contraindications: sortedContraindications }))
  }, [customerId])

  return { ...data, refetchGoalAndContraindications }
}

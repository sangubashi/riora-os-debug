/**
 * simulateMerge.ts — 統合プラン算出(Duplicate Merge Queue Phase2/3共通ロジック)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §4.3・docs/DUPLICATE_MERGE_SAFETY_VALIDATION.md
 *
 * DBへは一切書き込まない純粋関数。visit_count_atの再採番方式(来店日昇順に1から
 * 振り直す)は安全性検証(DUPLICATE_MERGE_SAFETY_VALIDATION.md)で実データ14グループ・
 * 58件全件のrollback完全復元・LTV完全一致を確認済みのロジックをそのまま踏襲する。
 */
import type {
  MergePlan, MergeVisitReassignment, MergeReservationReassignment, MergeHandoverNoteReassignment,
} from '../../types/customerMerge'

export interface SimulateMergeVisitInput {
  id: string
  customerId: string
  visitDate: string
  visitCountAt: number
}

export interface SimulateMergeCustomerInput {
  id: string
  firstVisitDate: string | null
}

/**
 * reservations.brain_customer_id の付け替え対象1件(CUSTOMER_MERGE_RESERVATION_MIGRATION_1)。
 * visit_count_atのような再採番は不要(reservationsは来店回数のカウント基準ではないため)、
 * 単純に統合元を指しているものを列挙するだけでよい。
 */
export interface SimulateMergeReservationInput {
  id: string
  brainCustomerId: string
}

/**
 * handover_notes.customer_id の付け替え対象1件(CUSTOMER_MERGE_HANDOVER_NOTES_MIGRATION_1)。
 * customerIdはlegacy customers.id空間の値(呼び出し側がresolveLegacyCustomerIds()等で
 * 事前に解決してから渡す。このファイル自体はDBアクセスを行わない純粋関数のため)。
 */
export interface SimulateMergeHandoverNoteInput {
  id: string
  customerId: string
}

/**
 * 生き残り(survivorId)を指定して統合プランを算出する。生き残りの選定自体は
 * detectDuplicateGroups.tsのselectRecommendedSurvivor相当を呼び出し側(API)が
 * 事前に決定し、ここでは受け取った候補群からプランを組み立てるだけに徹する
 * (「統合先はシステムが自動選択しない」というCUSTOMER_DUPLICATE_MANAGEMENT_V1.md
 * §4.2の設計判断を維持するため、実行API側は管理者が選択したsurvivorIdを必須で
 * 受け取る。ここではその値をそのまま使う)。
 */
export function simulateMerge(
  survivorId: string,
  members: SimulateMergeCustomerInput[],
  allVisits: SimulateMergeVisitInput[],
  allReservations: SimulateMergeReservationInput[],
  survivorLegacyId: string,
  mergedLegacyIds: string[],
  allHandoverNotes: SimulateMergeHandoverNoteInput[]
): MergePlan {
  const survivor = members.find(m => m.id === survivorId)
  if (!survivor) throw new Error(`simulateMerge: survivorId ${survivorId} が対象メンバーに含まれていません`)

  const mergedIds = members.filter(m => m.id !== survivorId).map(m => m.id)
  const firstVisitDateBefore = survivor.firstVisitDate

  const sortedVisits = [...allVisits].sort((a, b) => a.visitDate.localeCompare(b.visitDate) || a.id.localeCompare(b.id))
  const visitReassignments: MergeVisitReassignment[] = sortedVisits.map((v, idx) => ({
    visitId: v.id,
    fromCustomerId: v.customerId,
    oldVisitCountAt: v.visitCountAt,
    newVisitCountAt: idx + 1,
  }))

  // reservations.brain_customer_id の付け替え対象(統合元を指しているもののみ・
  // 生き残り自身を指しているものは変更不要)。visit_count_atのような再採番は不要。
  const reservationReassignments: MergeReservationReassignment[] = allReservations
    .filter(r => r.brainCustomerId !== survivorId)
    .map(r => ({ reservationId: r.id, fromCustomerId: r.brainCustomerId }))

  // handover_notes.customer_id の付け替え対象(legacy id空間。mergedLegacyIdsに
  // 含まれるものだけが対象。呼び出し側が事前にresolveLegacyCustomerIds()等で
  // legacy id集合を解決済みである前提)。
  const mergedLegacyIdSet = new Set(mergedLegacyIds)
  const handoverNoteReassignments: MergeHandoverNoteReassignment[] = allHandoverNotes
    .filter(h => mergedLegacyIdSet.has(h.customerId))
    .map(h => ({ handoverNoteId: h.id, fromCustomerId: h.customerId }))

  const allDates = allVisits.map(v => v.visitDate).sort()
  const firstVisitDateAfter = allDates.length > 0 ? allDates[0] : firstVisitDateBefore

  return {
    survivorId,
    mergedIds,
    survivorLegacyId,
    visitReassignments,
    reservationReassignments,
    handoverNoteReassignments,
    firstVisitDateBefore,
    firstVisitDateAfter,
  }
}

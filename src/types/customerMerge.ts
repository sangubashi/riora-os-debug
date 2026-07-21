/**
 * customerMerge.ts — 顧客統合(Duplicate Merge Queue)の共有型定義
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md・docs/DUPLICATE_MERGE_SAFETY_VALIDATION.md・
 * docs/DUPLICATE_CUSTOMER_MERGE_STRATEGY.md
 *
 * 重複グループはDBに永続化しない(brain_customers.name をtoNameKey()で都度グルーピングする
 * ステートレス設計。CSV Importのduplicate_customer_name警告と同じ考え方)。
 */

export type MergeGroupCategory = 'A' | 'B' | 'C'

export interface MergeGroupMemberSummary {
  customerId: string
  name: string
  visitCount: number
  totalSales: number
  firstVisitDate: string | null
  lastVisitDate: string | null
  assignedStaffNames: string[]
  createdAt: string
  /** システムによる生き残り推奨(§2の選定ルール: visit数最多、同数ならcreated_at最古)。 */
  recommendedSurvivor: boolean
}

export interface MergeGroupSummary {
  /** toNameKey()の結果。URLパスセグメントとして使うためencodeURIComponent前提。 */
  groupKey: string
  /** グループ内の代表氏名(表記ゆれがある場合は最も件数の多い表記)。 */
  displayName: string
  memberCount: number
  category: MergeGroupCategory
  totalVisitCount: number
  totalSales: number
  lastVisitDate: string | null
  /** グループ内に全角スペース有無等の表記ゆれがあるか。 */
  hasNotationVariance: boolean
}

export interface MergeGroupContraindication {
  customerId: string
  severity: string
  title: string
  description: string | null
}

export interface MergeGroupDetail {
  groupKey: string
  category: MergeGroupCategory
  members: MergeGroupMemberSummary[]
  contraindications: MergeGroupContraindication[]
  /** §2の選定ルールで決まる推奨生き残りID。 */
  recommendedSurvivorId: string | null
}

export interface MergeVisitReassignment {
  visitId: string
  fromCustomerId: string
  oldVisitCountAt: number
  newVisitCountAt: number
}

/**
 * reservations.brain_customer_id の付け替え1件分(CUSTOMER_MERGE_RESERVATION_MIGRATION_1)。
 * Todayタブ(/api/home/reservations・/api/today-briefing)は brain_customer_id 単位で
 * 重複排除するため、統合元(消える側)を指したままの予約が残ると重複表示の原因になる。
 */
export interface MergeReservationReassignment {
  reservationId: string
  fromCustomerId: string
}

/**
 * handover_notes.customer_id の付け替え1件分(CUSTOMER_MERGE_HANDOVER_NOTES_MIGRATION_1)。
 * handover_notesはlegacy customers.id空間を参照するため、fromCustomerId/toCustomerIdは
 * brain_customers.idそのものではなくlegacy id(通常はミラー行によりbrain_customers.idと
 * 同値だが、ブリッジ経由の場合は異なりうる)。
 */
export interface MergeHandoverNoteReassignment {
  handoverNoteId: string
  fromCustomerId: string
}

export interface MergePlan {
  survivorId: string
  mergedIds: string[]
  /** 統合先(survivorId)のlegacy customers.id(通常はミラーによりsurvivorIdと同値)。
   *  handover_notes.customer_id への書き込み先として使う。 */
  survivorLegacyId: string
  visitReassignments: MergeVisitReassignment[]
  reservationReassignments: MergeReservationReassignment[]
  handoverNoteReassignments: MergeHandoverNoteReassignment[]
  firstVisitDateBefore: string | null
  firstVisitDateAfter: string | null
}

/** brain_ops_logs(kind='customer_merge')のdetailに保存する監査ログ本体。 */
export interface CustomerMergeAuditDetail {
  mergeGroupId: string
  sourceCustomerIds: string[]
  targetCustomerId: string
  /** handover_notes.customer_id復元時の照合に使う統合先legacy id(§MergePlan参照)。 */
  survivorLegacyId: string
  executedAt: string
  executedBy: string
  visitReassignments: MergeVisitReassignment[]
  reservationReassignments: MergeReservationReassignment[]
  handoverNoteReassignments: MergeHandoverNoteReassignment[]
  firstVisitDateBefore: string | null
  firstVisitDateAfter: string | null
}

/** brain_ops_logs(kind='customer_merge_rollback')のdetailに保存する監査ログ本体。 */
export interface CustomerMergeRollbackAuditDetail {
  originalMergeOpsLogId: string
  mergeGroupId: string
  restoredCustomerIds: string[]
  targetCustomerId: string
  executedAt: string
  executedBy: string
}

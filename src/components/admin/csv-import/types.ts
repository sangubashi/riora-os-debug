/**
 * types.ts — CSV Import Management(画面⑥)の型定義
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4,5
 *   - docs/architecture/SalonBoard_CSV_Import_Implementation_Architecture_v1.0.md §5,6
 *   - scripts/csv-import-dry-run.ts(DryRunReport/StaffResolutionの実装済み形状)
 *
 * 本ファイルはUIが依存する型のみを持つ。実APIに繋ぐ際はこの型をそのまま
 * レスポンス型として使う想定(mockApi.ts → 実API差し替えのみで完結させる)。
 */

export type ImportState = 'idle' | 'parsing' | 'dryrun_done' | 'importing' | 'done' | 'error'

export type SkipReasonCode =
  | 'invalid_date'
  | 'missing_name'
  | 'duplicate_in_file'
  | 'future_date'
  | 'amount_out_of_range'
  /** 会計ID内の整合性エラー(客/スタッフ/会計日時の複数値・メニュー行0/2件以上・日時解釈不能等)。
   *  実APIでは集約自体ができないため個々のrowNumberを持たず、checkoutIdのみ付与される。 */
  | 'checkout_integrity_error'
  /** スタッフ名が brain_staff.name/name_aliases のいずれにも一致せず、取込時点でも紐付け未確定。 */
  | 'unresolved_staff'

export const SKIP_REASON_LABEL: Record<SkipReasonCode, string> = {
  invalid_date: '来店日が不正',
  missing_name: '氏名が空欄',
  duplicate_in_file: 'ファイル内で重複(同一会員番号×来店日)',
  future_date: '未来日付',
  amount_out_of_range: '金額が範囲外(0〜500,000円)',
  checkout_integrity_error: '会計内のデータ不整合',
  unresolved_staff: 'スタッフ名が未紐付け',
}

export interface SkipItem {
  /** 集約自体に失敗した会計(checkout_integrity_error)はrowNumberを割り当てられず、checkoutIdのみ設定される。 */
  rowNumber?: number
  reasonCode: SkipReasonCode
  checkoutId?: string
}

export interface ReviewItem {
  rowNumber: number
  customerName: string
  candidateMatchName: string
}

export type ReviewDecisionValue = 'merge' | 'new'

export interface UnresolvedStaffName {
  rawName: string
  normalized: string
  occurrenceCount: number
  /** 表記ゆれヒューリスティックによる紐付け候補(任意・suggestのみ・自動確定はしない) */
  suggestedStaffId?: string
}

export interface PreviewRow {
  name: string
  gender: string | null
  ageGroup: string | null
  prefecture: string | null
  city: string | null
  firstVisitDate: string | null
}

export interface ValidationResult {
  fileName: string
  totalRows: number
  importable: number
  needsReview: ReviewItem[]
  skipped: SkipItem[]
  unknownColumns: string[]
  droppedColumns: string[]
  piiFoundTotal: number
  unresolvedStaff: UnresolvedStaffName[]
  preview: PreviewRow[]
  qualityReport: CsvQualityReport
  /** アップロード時に列名から自動判定したCSV形式。 */
  csvType: 'detail' | 'reservation' | 'unknown'
  /** 情報メッセージ(予約CSVの場合のみ設定される)。エラーではない。 */
  csvInfoMessage: string | null
}

/** menuResolver.resolveMenuId()のMenuResolutionMethod + 'unresolved'(フォールバック行も無い場合)。 */
export type MenuResolutionLogMethod = 'exact_match' | 'normalized_match' | 'partial_match' | 'keyword_match' | 'fallback_other' | 'unresolved'

/**
 * CSV内に出現した一意なメニュー名ごとの解決結果(Pass C: 名寄せ精度改善の追跡用)。
 * メニュー名は個人情報ではないため、ops_logs(brain_ops_logs.detail)へそのまま記録してよい
 * (CSVImportSecurityArchitecture.mdのPII方針はお客様個人情報のみが対象)。
 */
export interface MenuResolutionLogEntry {
  rawMenuName: string
  resolvedMenuId: string | null
  resolvedMenuName: string | null
  resolutionMethod: MenuResolutionLogMethod
  occurrenceCount: number
}

export interface MenuResolutionSummary {
  exactMatch: number
  normalizedMatch: number
  partialMatch: number
  fallbackOther: number
  unresolved: number
  entries: MenuResolutionLogEntry[]
}

export interface ImportReport {
  newCustomers: number
  updatedCustomers: number
  visitsImported: number
  piiFoundTotal: number
  failedChunks: number
  durationMs: number
  menuResolution: MenuResolutionSummary
  /**
   * スタッフ名が未解決のため取込スキップされた行数(Pass D: 以前から計算されていたが
   * brain_ops_logs.detailにのみ記録され、API応答(ImportReport)には含まれていなかった
   * 欠落を修正)。0件以外の場合、該当行は来店データとして取り込まれていない。
   */
  unresolvedStaffCount: number
  qualityReport: CsvQualityReport
}

/** CSV Import品質レポート(Pass D・実フォーマット専用。csvQualityChecker.tsとは別物)。 */
export type CsvQualityLevel = 'excellent' | 'good' | 'fair' | 'poor'

export interface CsvQualityWarning {
  type: 'unresolved_staff' | 'duplicate_customer_name' | 'needs_review_pending' | 'menu_unmatched'
  message: string
  count: number
  severity: 'error' | 'warn' | 'info'
}

/**
 * 解決率・件数の総括(Pass D拡張・最終報告の必須記載項目)。すべて0〜1の割合(rate)、
 * totalCheckoutsで除した値。totalCheckouts=0の場合は全率0とする。
 */
export interface CsvImportRates {
  /** 会員番号(external_key_hash)による確定一致の割合。会員番号が無いCSVでは常に低くなる
   *  (=氏名のみでの突合に依存している割合が高いことを意味し、重複顧客リスクの直接の指標)。 */
  customerResolutionRate: number
  /** スタッフ名が解決できた割合(1 - unresolvedStaffCount/totalCheckouts)。 */
  staffResolutionRate: number
  /** メニュー名がexact/normalized/partialのいずれかで解決できた割合(imported_otherへ
   *  集約されなかった割合)。 */
  menuResolutionRate: number
  /** メニュー名がimported_otherへ集約された割合(fallback_other + unresolved)。 */
  importedOtherRate: number
  /** パース/会計集約段階のエラー件数(会計内不整合・必須列欠落等・severity='error')。 */
  errorCount: number
  /** 取込対象外となった会計の総数(スタッフ未解決+メニュー未解決+パースエラー)。 */
  skippedCount: number
}

export interface CsvQualityReport {
  score: number
  level: CsvQualityLevel
  totalCheckouts: number
  warnings: CsvQualityWarning[]
  menuResolution: MenuResolutionSummary
  /** 会員番号が無いCSVで同一氏名が複数回出現する顧客(顧客名寄せの重複リスク・自動マージはしない)。 */
  duplicateCustomerNames: { name: string; occurrenceCount: number }[]
  rates: CsvImportRates
}

export interface ImportHistoryItem {
  id: string
  importedAt: string
  actorName: string
  newCustomers: number
  updatedCustomers: number
  visits: number
  unresolvedStaffCount: number
}

export interface StaffOption {
  id: string
  name: string
}

export interface StaffAlias {
  id: string
  alias: string
  staffId: string
  staffName: string
  createdAt: string
  createdBy: string
}

/** GET /api/admin/staff-aliases のレスポンス形状(店舗のスタッフ一覧+登録済み別名を1回で返す)。 */
export interface StaffAliasListResponse {
  staffOptions: StaffOption[]
  aliases: StaffAlias[]
}

// ================================================================
// 予約CSV Import(RES-5・Phase RES-2/RES-3設計に基づく実装)
// 既存の売上明細CSV用型(ValidationResult/ImportReport等)とは完全に独立させる
// (docs/design/RESERVATION_IMPORT_IMPLEMENTATION_PLAN_V1.md §8方針)。
// ================================================================

export type ReservationSkipReasonCode =
  | 'missing_field'
  | 'unresolved_staff'
  | 'unresolved_status'
  | 'invalid_datetime'

export interface ReservationSkipItem {
  rowNumber: number
  reasonCode: ReservationSkipReasonCode
}

export interface ReservationNeedsReviewItem {
  rowNumber: number
  customerName: string
  candidateMatchName: string
}

export interface ReservationPreviewRow {
  rowNumber: number
  visitDate: string
  startTime: string
  endTime: string
  durationMinutes: number
  staffNameRaw: string
  menuName: string
  statusRaw: string
  mappedStatus: string | null
  customerName: string
}

export interface ReservationValidationResult {
  fileName: string
  totalRows: number
  importable: number
  needsReview: ReservationNeedsReviewItem[]
  skipped: ReservationSkipItem[]
  unresolvedStaff: UnresolvedStaffName[]
  preview: ReservationPreviewRow[]
}

export interface ReservationImportReport {
  created: number
  updated: number
  skipped: number
  needsReviewCount: number
  durationMs: number
}

/** brain_ops_logs.detail.skippedDetail 1件分(CSV_IMPORT_HISTORY_UI_1: 履歴画面でのスキップ理由確認用)。 */
export interface SkippedDetailEntry {
  rowNumber: number
  customerName: string
  reasonCode: ReservationSkipReasonCode
}

export const SKIPPED_DETAIL_REASON_LABEL: Record<ReservationSkipReasonCode, string> = {
  missing_field: '必須項目不足',
  invalid_datetime: '日付形式不正',
  unresolved_status: 'ステータス変換失敗',
  unresolved_staff: 'スタッフ未解決',
}

/** GET /api/admin/csv/history の予約CSV取込(kind='reservation_csv_import')側レスポンス項目。 */
export interface ReservationImportHistoryItem {
  id: string
  importedAt: string
  actorName: string
  created: number
  updated: number
  skipped: number
  needsReviewCount: number
  skippedDetail: SkippedDetailEntry[]
}

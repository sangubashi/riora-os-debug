export type CautionKind = 'contraindication' | 'ng_topic' | 'focus'

export interface TodayBriefingCaution {
  kind: CautionKind
  text: string
}

export interface TodayBriefingNextCustomer {
  reservationId: string
  customerId:    string
  customerName:  string
  visitCount:    number
  customerType:  string
  staffName:     string | null
  scheduledAt:   string
  minutesUntil:  number
  /** 予約メニュー（reservations.menu）。値がある場合のみ非null（CUSTOMER_BRIEFING_IMPLEMENT_1）。 */
  reservationMenu:  string | null
  /** 予約備考（reservations.notes）。値がある場合のみ非null（CUSTOMER_BRIEFING_IMPLEMENT_1）。 */
  reservationNotes: string | null
}

export interface TodayBriefingDetail {
  lastVisitDate: string | null
  lastVisitMenu: string | null
  memoryNote:    string | null
  aiSummary:     string | null
  /** 引継ぎメモ（handover_notes.summary）。aiSummaryとは独立公開（CUSTOMER_BRIEFING_IMPLEMENT_3）。 */
  handoverNote:  string | null
  /** 最近の変化（timeline_summary_cache.recent_change）。生成済みキャッシュのみ参照（TODAY_BRIEFING_IMPLEMENT_4）。 */
  recentChange:  string | null
  /** 今回意識すること（timeline_summary_cache.next_focus・最大3件）。生成済みキャッシュのみ参照（TODAY_BRIEFING_IMPLEMENT_4）。 */
  nextFocus:     string[]
}

export interface TodayBriefingUpcoming {
  reservationId: string
  customerId:    string
  customerName:  string
  visitCount:    number
  scheduledAt:   string
}

/**
 * 今日タブ最上部「今日のブリーフィング」カード用の日次サマリー(PHASE STAFF-NOTIFICATION-AI)。
 * ルールベースのみ・LLM不使用。既存データ(予約・初回来店フラグ・禁忌・重要メモ・
 * ホームケア提案タイミング・誕生日)から都度計算する。
 */
export interface TodayBriefingSummary {
  /** 本日の来店人数(予約件数)。 */
  visitCount: number
  /** 初回来店(reservations.is_new_customer=true)の人数。 */
  firstVisitCount: number
  /** 禁忌事項(contraindications)が登録されているお客様の人数。 */
  contraindicationCount: number
  /** ホームケア提案タイミング(使い方案内・使い心地確認・補充のいずれか)に該当するお客様の人数。 */
  homecareCount: number
  /** お誕生日が近い(customer_memories基準)お客様の人数。 */
  birthdayCount: number
  /** 重要な申し送り(customer_memories.importance='high')があるお客様の人数。 */
  importantMemoCount: number
}

export interface TodayBriefingResponse {
  next:     TodayBriefingNextCustomer | null
  cautions: TodayBriefingCaution[]
  detail:   TodayBriefingDetail
  upcoming: TodayBriefingUpcoming[]
  summary:  TodayBriefingSummary
}

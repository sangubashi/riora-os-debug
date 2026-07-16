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

export interface TodayBriefingResponse {
  next:     TodayBriefingNextCustomer | null
  cautions: TodayBriefingCaution[]
  detail:   TodayBriefingDetail
  upcoming: TodayBriefingUpcoming[]
}

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
}

export interface TodayBriefingDetail {
  lastVisitDate: string | null
  lastVisitMenu: string | null
  memoryNote:    string | null
  aiSummary:     string | null
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

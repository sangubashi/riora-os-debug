/**
 * storeLearning.ts — Store Learning 専用型定義
 *
 * 注意: ActionType は index.ts の ActionType と別物。
 * こちらはサロン接客アクションの意味的分類（日本語ラベル直接）。
 */

export type ActionType =
  | 'ホームケア提案'
  | '商品提案'
  | '再来提案'
  | 'LINE送信'
  | '接客トーク'
  | '価格提示'
  | '施術内提案'

export type StaffStyle =
  | '共感型'
  | '提案型'
  | '分析型'
  | '癒し型'
  | 'ストレート型'

export type DisplaySection =
  | 'aiInsight'
  | 'nextAction'
  | 'voiceMemo'
  | 'lineDraft'
  | 'timeline'
  | 'storeLearning'
  | 'serviceReplay'
  | 'homecare'
  | 'predictiveSuggestions'
  | 'riskCard'

export type SuccessPattern = {
  id: string

  customerId?:   string
  customerTags:  string[]

  staffId:       string
  staffName?:    string

  actionType:    ActionType
  actionContent: string
  actionCategory?: string

  outcome: {
    reVisitRate?:          number
    lineReplyRate?:        number
    salesUp?:              number
    /** 0-100 */
    successScore:          number
    qualitativeFeedback?:  string
  }

  context: {
    season?:            string
    concerns?:          string[]
    insightTags?:       string[]
    relationshipState?: string
    visitCycleDays?:    number
    timeOfDay?:         string
  }

  timing: {
    minutesAfterService?: number
    beforeCheckout?:      boolean
    serviceType?:         string
  }

  staffStyle: StaffStyle

  /** 0-1 */
  effectiveness: number

  /** 最低5以上推奨 */
  sampleSize: number

  lastUpdated: string
  createdAt:   string
}

export type StoreLearning = {
  section:        DisplaySection
  recommendation: string
  /** 0-1 */
  confidence:     number
  reasons:        string[]
  examplePatterns: SuccessPattern[]
}

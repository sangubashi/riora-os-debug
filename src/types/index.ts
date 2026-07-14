export type UserRole = 'admin' | 'staff';
export type Screen = 'login' | 'app' | 'service' | 'line-admin';

export type CampaignStatus = 'draft' | 'approved' | 'sent' | 'rejected';

export interface LineCampaign {
  id: string;
  title: string;
  body: string;
  target_tags: string[];
  status: CampaignStatus;
  approved_by: string | null;
  sent_at: string | null;
  created_at: string;
}
export type Trend = 'up' | 'down' | 'neutral';
export type CustomerType =
  | '慎重・不安型'
  | '感情重視型'
  | '効果重視型'
  | '信頼構築型'
  | 'VIP型';

export interface StaffProfile {
  id: string;
  name: string;
  firstName: string;
  role: UserRole;
}

export interface KpiMetric {
  label: string;
  value: string;
  diff: string;
  trend: Trend;
  wide?: boolean;
}

export interface BarDatum {
  label: string;
  heightPct: number;
  highlight?: boolean;
}

export interface AiPoint {
  text: string;
}

export interface KillerPhrase {
  scene: string;
  line: string;
}

export interface RejectionPattern {
  trigger: string;
  meaning: string;
  counter: string;
}

/** AI接客フロー用（camelCase）— 旧来コンポーネント・モックデータ専用 */
export interface CustomerProfile {
  id: string;
  hashId?: string;
  churnRisk?: number;
  staffId: string;
  name: string;
  customerType: CustomerType;
  aiOneLiner: string;
  visits: number;
  lastVisitDaysAgo: number;
  tags: string[];
  aiPoints: AiPoint[];
  ngAction: string;
  rioraMessage: string;
  rejectionPatterns: RejectionPattern[];
  previousConcerns: string[];
}

/** ai_suggestions テーブルの行 */
export interface AiSuggestion {
  id: string;
  customer_hash_id: string;
  suggested_menu: string | null;
  suggested_tone: string | null;
  strategy_logic: {
    nextVisitMessage?: string;
    adviceMessage?: string;
    adviceTag?: '[AI]';
    salonType?: string;
    riskScore?: number;
    vipCandidate?: boolean;
    customerType?: string;
  } | null;
  created_at: string;
}

/** Supabase 統一型（snake_case）— 予約・ストア・新規コンポーネント共通 */
export interface Customer {
  id: string;
  name: string;
  visits: number;
  visit_count: number;
  total_sales: number;
  avg_price: number;
  last_visit: string;
  customer_type: CustomerType;
  /** brain_customers.customer_type の生値(PHASE HOMECARE-V12-MVP-1)。
   *  customer_type(接客スタイル型)とは別軸。ホームケアのbyCustomerType出し分けに使用 */
  skinConcernType?: string | null;
  vip_rank: number;
  churn_risk: number;
  line_response_rate: number;
  next_visit_prediction: string;
  skin_tags?: string[];
  homecare_notes?: string | null;
  recommended_cycle_days?: number | null;
  last_product_purchase?: Record<string, unknown> | null;
  /** 多店舗展開用（将来対応）。未指定時はデフォルト店舗 */
  store_id?: string;
}

/** reservations テーブルの行（フロント表示用） */
export interface Reservation {
  /** 顧客タブ等、実予約に紐づかない起動元からは null になり得る */
  id: string | null;
  customer_id: string | null;
  customer_hash_id: string | null;
  staff_id: string;
  menu: string;
  scheduled_at: string;
  status: string;
  customer_name: string;
  is_vip: boolean;
  churn_risk: number;
  days_since_last_visit: number;
  customer_type: CustomerType;
  customer?: Customer;
  /** 多店舗展開用（将来対応）。未指定時はデフォルト店舗 */
  store_id?: string;
}

export interface TreatmentRecord {
  customerId: string;
  staffId: string;
  date: string;
  proposed: boolean;
  sold: boolean;
  nextBooked: boolean;
}


export interface StaffDashboard {
  customers: CustomerProfile[];
  rioraDailyMsg: string;
}
// ─── ホームケア伴走 ──────────────────────────────────────────────────────────

export const SKIN_TAG_LABELS: Record<string, string> = {
  dry:          '乾燥',
  oily:         '脂性',
  sensitive:    '敏感',
  acne:         'ニキビ',
  pigmentation: 'シミ',
  redness:      '赤み',
  dehydration:  '水分不足',
  aging:        'エイジング',
  pore:         '毛穴',
}

export const SKIN_TAG_KEYS = Object.keys(SKIN_TAG_LABELS) as SkinTagKey[]
export type SkinTagKey = keyof typeof SKIN_TAG_LABELS

export interface HomecarePlan {
  todayCare:    string[]   // 今日やるべきケア
  ngActions:    string[]   // NG行動
  cautions:     string[]   // 次回来店までの注意
  products:     string[]   // 商品提案
  cycleDays:    number     // 推奨来店サイクル（日）
  lineDraft:    string     // LINE下書き文
}

// ─── 行動ログ（PHASE 1.5） ───────────────────────────────────────────────────

export const ACTION_TYPE_LABELS = {
  line_sent:           'LINE送信',
  homecare_explained:  'ホームケア説明',
  rebook_recommended:  '次回提案',
  product_recommended: '商品提案',
  product_purchased:   '商品購入',
  voice_note_created:       '音声メモ追加',
  voice_insight_generated:  'AIインサイト生成',
  voice_started:            '録音開始',
  voice_cancelled:          '録音キャンセル',
  voice_discarded:          '音声破棄',
  voice_saved:              '音声メモ保存',
  voice_undo:               '音声保存取り消し',
  next_action_line:         'LINE送信実施',
  next_action_rebook:       '再来提案実施',
  next_action_product:      '商品提案実施',
  next_action_vip:          'VIPフォロー実施',
  next_action_homecare:     'ホームケアフォロー実施',
  next_action_inactive:     '離脱リスク対応実施',
} as const

export type ActionType = keyof typeof ACTION_TYPE_LABELS

export interface CustomerActionLog {
  id:             string
  customer_id:    string
  staff_id:       string | null
  action_type:    ActionType
  action_payload: Record<string, unknown> | null
  created_at:     string
  /** 多店舗展開用（将来対応）。未指定時はデフォルト店舗 */
  store_id?:      string
}

// ─── 音声メモ（PHASE 2） ─────────────────────────────────────────────────────

export type VoiceNoteAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface VoiceNote {
  id:              string
  customer_id:     string
  staff_id:        string | null
  reservation_id:  string | null
  storage_path:    string
  transcript:      string | null
  summary:         string | null
  insight_tags:    string[] | null
  duration_sec:    number | null
  analysis_status: VoiceNoteAnalysisStatus
  created_at:      string
  /** 多店舗展開用（将来対応）。未指定時はデフォルト店舗 */
  store_id?:       string
}

// ─── Booking Prompt（来店前 AI 接客ブリーフ） ────────────────────────────────────

export interface BookingPrompt {
  id:                    string
  customer_id:           string
  reservation_id:        string | null
  store_id:              string | null
  summary:               string
  recommended_topics:    string[]
  recommended_proposals: string[]
  risk_flags:            string[]
  confidence:            number
  generated_at:          string
  created_at:            string
}

// ─── Contraindication AI（禁忌・注意事項） ───────────────────────────────────────

export type ContraindicationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export const CONTRAINDICATION_SEVERITY_ORDER: ContraindicationSeverity[] = [
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW',
]

export const CONTRAINDICATION_SEVERITY_LABEL: Record<ContraindicationSeverity, string> = {
  CRITICAL: '施術禁止',
  HIGH:     '要確認',
  MEDIUM:   '注意',
  LOW:      '配慮',
}

export const CONTRAINDICATION_SEVERITY_COLOR: Record<ContraindicationSeverity, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: '#FFF0F2', text: '#C00020', border: '#F0B0B8' },
  HIGH:     { bg: '#FFF4EC', text: '#C06010', border: '#F0C898' },
  MEDIUM:   { bg: '#FFFBF0', text: '#A07020', border: '#E8D890' },
  LOW:      { bg: '#F0FAF7', text: '#208060', border: '#A0D8C0' },
}

export interface Contraindication {
  id:              string
  customer_id:     string
  reservation_id:  string | null
  store_id:        string | null
  severity:        ContraindicationSeverity
  title:           string
  description:     string | null
  recommendation:  string | null
  source:          string | null
  source_note_id:  string | null
  confidence:      number
  generated_at:    string
  created_at:      string
}

// ─── AI Handover（担当スタッフ引継ぎノート） ─────────────────────────────────────

export interface HandoverNote {
  id:                  string
  customer_id:         string
  reservation_id:      string | null
  store_id:            string | null
  summary:             string
  customer_context:    string[]
  open_tasks:          string[]
  recommended_actions: string[]
  risk_flags:          string[]
  confidence:          number
  generated_at:        string
  created_at:          string
}

// ─── カスタマーノート（AI自動生成 / 手動メモ） ──────────────────────────────────

export type NoteCategory = 'Family' | 'Work' | 'Health' | 'Preference' | 'Event'

export const NOTE_CATEGORY_LABELS: Record<NoteCategory, string> = {
  Family:     '家族',
  Work:       '仕事',
  Health:     '健康',
  Preference: '好み・趣味',
  Event:      'イベント',
}

export const NOTE_CATEGORY_ICONS: Record<NoteCategory, string> = {
  Family:     '👨‍👩‍👧',
  Work:       '💼',
  Health:     '💊',
  Preference: '⭐',
  Event:      '🎉',
}

export interface CustomerNote {
  id:             string
  customer_id:    string
  staff_id:       string | null
  note:           string
  category:       NoteCategory | null
  source:         'voice_note' | 'manual'
  voice_note_id:  string | null
  created_at:     string
}

// ─── AIインサイトタグ（PHASE 3） ─────────────────────────────────────────────

export const INSIGHT_TAG_LABELS: Record<string, string> = {
  // 肌悩み（既存）
  dryness_concern:   '乾燥気になる',
  price_sensitive:   '価格感度高め',
  event_before:      'イベント前需要',
  low_homecare:      'ホームケア不足',
  high_motivation:   '来店モチベ高い',
  sensitive_skin:    '敏感肌ケア需要',
  acne_concern:      'ニキビ気になる',
  aging_concern:     'エイジング意識',
  redness_concern:   '赤み気になる',
  busy_lifestyle:    '多忙ライフスタイル',
  // 次回提案（新規）
  suggest_peel:      'ピーリング提案',
  suggest_whitening: 'ホワイトニング提案',
  suggest_premium:   'プレミアム提案',
  suggest_homecare:  'ホームケア提案',
  suggest_rebook:    '早期予約提案',
  // NGワード（新規）
  ng_price:          'NG:価格言及注意',
  ng_compare:        'NG:比較言及注意',
  ng_time:           'NG:時間プレッシャー注意',
  // 購入傾向（新規）
  buy_impulse:       '衝動買い傾向',
  buy_compare:       '比較検討派',
  buy_loyal:         'リピート購入派',
  buy_trial:         'お試し好み',
}

export type InsightTag = keyof typeof INSIGHT_TAG_LABELS

export interface CustomerInsightSummary {
  customerId:  string
  tags:        InsightTag[]
  /** 直近N件の音声メモから集計したタグ出現回数 */
  tagCounts:   Partial<Record<InsightTag, number>>
  lastUpdated: string
}

// ─── NextAction Engine（PHASE 4） ───────────────────────────────────────────

export type NextActionType =
  | 'line_follow'
  | 'rebook'
  | 'product_offer'
  | 'vip_follow'
  | 'homecare_follow'
  | 'inactive_risk'
  // フェーズ別 AI 提案
  | 'phase_new_rebook'       // new    → 次回予約提案
  | 'phase_growing_course'   // growing → 回数券提案
  | 'phase_repeat_product'   // repeat  → 店販提案
  | 'phase_vip_premium'      // vip     → 高額コース提案
  | 'phase_risk_line'        // risk    → LINEフォロー提案

export type NextActionPriority = 'high' | 'medium' | 'low'

export interface NextAction {
  id:          string
  type:        NextActionType
  priority:    NextActionPriority
  score:       number
  title:       string
  description: string
  /** ボタンラベル（「LINE下書き作成」「提案完了」等） */
  ctaLabel:    string
  /** action_logs に記録する action_type */
  logType:     ActionType
  /** 提案理由タグ（例: 「来店45日経過」「LINE返信率82%」） */
  reasons?:    string[]
}

// ─── AI Memory Surface・Timeline・Silent Automation（PHASE 4.6） ────────────

/** 顧客の会話から抽出した記憶アイテム */
export interface MemoryItem {
  id:          string
  customer_id: string
  category:    'hobby' | 'event' | 'skin' | 'life' | 'preference'
  content:     string        // 例: 「来月娘の結婚式がある」
  source:      'voice_note' | 'manual'
  confidence:  number        // 0〜1
  created_at:  string
}

export const MEMORY_CATEGORY_LABELS: Record<MemoryItem['category'], string> = {
  hobby:      '趣味・好み',
  event:      'イベント',
  skin:       '肌悩み',
  life:       'ライフイベント',
  preference: 'こだわり',
}

/** 顧客タイムラインイベント */
export interface TimelineEvent {
  id:            string
  created_at:    string
  kind:          'visit' | 'line' | 'product' | 'voice' | 'insight' | 'action'
  label:         string
  detail?:       string
  insight_tags?: string[] | null
  icon:          string
}

/** 音声メモ停止後の Silent Automation 結果 */
export interface SilentSuggestion {
  insightTags:    string[]
  nextActions:    NextAction[]
  lineDraftHint:  string | null   // LINE文言のヒント
  productHint:    string | null   // 商品提案候補
}

// ─── PHASE 5 ─────────────────────────────────────────────────────────────────

/** 顧客リスク分析結果 */
/** 顧客フェーズ */
export type CustomerPhase = 'new' | 'growing' | 'repeat' | 'vip' | 'risk'

export const CUSTOMER_PHASE_LABEL: Record<CustomerPhase, string> = {
  new:     '新規',
  growing: '育成',
  repeat:  'リピーター',
  vip:     'VIP',
  risk:    '離脱危険',
}

export const CUSTOMER_PHASE_COLOR: Record<CustomerPhase, string> = {
  new:     '#6C757D',
  growing: '#74C69D',
  repeat:  '#52B788',
  vip:     '#FFD166',
  risk:    '#EF476F',
}

/** 顧客スコア内訳 */
export interface CustomerScoreBreakdown {
  visits:       { score: number; max: number; label: string }
  sales:        { score: number; max: number; label: string }
  retailSales:  { score: number; max: number; label: string }
  lineResponse: { score: number; max: number; label: string }
  referral:     { score: number; max: number; label: string }
  retention:    { score: number; max: number; label: string }
}

/** 顧客スコア結果 */
export interface CustomerScoreResult {
  total:     number          // 0〜100
  phase:     CustomerPhase
  breakdown: CustomerScoreBreakdown
}

/** VIP類似度の軸ごとの評価 */
export interface SimilarityAxis {
  label:    string   // 例: '来店回数'
  customer: number   // 顧客値（正規化済み 0〜1）
  vipAvg:   number   // VIP平均値（正規化済み 0〜1）
  gap:      'near' | 'close' | 'far'  // 類似度判定
  comment:  string   // 例: '来店回数が近い' or '累計売上が不足'
}

/** VIP類似度結果 */
/** 顧客分析: フェーズ別統計 */
export interface PhaseStats {
  phase:        CustomerPhase
  label:        string
  count:        number
  avgSales:     number
  avgVisits:    number
  purchaseRate: number
  rebookRate:   number
}

/** 顧客分析: 上位顧客プロフィール */
export interface TopCustomerProfile {
  avgVisits:       number
  avgLineResponse: number
  avgSales:        number
  purchaseRate:    number
  count:           number
}

/** 顧客分析: インサイト1件 */
export interface StoreInsightItem {
  id:      string
  message: string
  metric?: string
}

/** 顧客分析結果 */
export interface CustomerAnalyticsResult {
  phaseStats:     PhaseStats[]
  topProfile:     TopCustomerProfile
  insights:       StoreInsightItem[]
  totalCustomers: number
}

/** AI店舗学習: 成功法則1件 */
export interface StoreLearningRule {
  rank:        number   // 1〜
  title:       string   // 例: 'プレミアムエイジング利用'
  effect:      string   // 例: 'VIP率上昇'
  impact:      number   // 影響度スコア 0〜100
  evidence:    string   // 根拠テキスト（例: 「VIPの78%が利用」）
  category:    'treatment' | 'product' | 'behavior' | 'cycle'
}

/** AI店舗学習結果 */
export interface StoreLearningResult {
  rules:      StoreLearningRule[]
  summary:    string     // 1行サマリ
  updatedAt:  string     // ISO文字列（計算日時）
}

/** VIP共通特徴 */
export interface VipProfile {
  count:           number   // VIP人数
  avgVisits:       number   // 平均来店回数
  avgSales:        number   // 平均累計売上
  avgLineResponse: number   // 平均LINE返信率
  avgCycleDays:    number   // 平均来店周期（日）
  purchaseRate:    number   // 店販購入率 (0〜100)
}

/** VIPが利用している施術・商品ランキング行 */
export interface VipRankItem {
  name:    string
  rate:    number   // VIP内の割合 (0〜100)
  count:   number
}

/** VIP成功パターン分析結果 */
export interface VipAnalyticsResult {
  profile:          VipProfile
  treatmentRanking: VipRankItem[]
  productRanking:   VipRankItem[]
  insights:         string[]
}

/** 商品統計 */
export interface ProductStats {
  name:         string
  buyerCount:   number   // 購入人数
  totalRevenue: number   // 売上合計
  repeatRate:   number   // リピート率 (0〜100)
  rebookRate:   number   // 次回予約率 (0〜100)
  vipRate:      number   // VIP率 (0〜100)
}

/** 商品分析結果 */
export interface ProductAnalyticsResult {
  products:       ProductStats[]
  salesRanking:   ProductStats[]   // 売上ランキング
  vipRanking:     ProductStats[]   // VIP率ランキング
  rebookRanking:  ProductStats[]   // 次回予約率ランキング
  insights:       string[]
  totalBuyers:    number
}

/** 施術統計 */
export interface TreatmentStats {
  name:           string   // 施術名
  customerCount:  number   // 顧客数
  avgSales:       number   // 平均累計売上
  repeatRate:     number   // リピート率 (0〜100)
  rebookRate:     number   // 次回予約率 (0〜100)
  purchaseRate:   number   // 店販購入率 (0〜100)
}

/** 施術分析結果 */
export interface TreatmentAnalyticsResult {
  treatments:       TreatmentStats[]
  salesRanking:     TreatmentStats[]   // 平均売上ランキング
  repeatRanking:    TreatmentStats[]   // リピート率ランキング
  rebookRanking:    TreatmentStats[]   // 次回予約率ランキング
  insights:         string[]           // AIインサイト
  totalCustomers:   number
}

export interface CustomerSimilarityResult {
  score:    number            // 0〜100
  axes:     SimilarityAxis[]
  summary:  string            // AIコメント（1文）
}

/** VIP昇格シミュレーター: 不足項目 */
export interface VipGapItem {
  label:      string   // 例: '来店回数'
  current:    number   // 現在値
  vipAvg:     number   // VIP平均
  gap:        number   // 不足量（正の数）
  unit:       string   // '回' or '円' or '%'
  actionText: string   // 例: 'あと3回来店'
  priority:   number   // 優先度（高いほど先に表示）
}

/** VIP昇格シミュレーター結果 */
export interface VipPromotionResult {
  similarityScore: number       // 現在の類似度
  isAlreadyVip:    boolean
  gaps:            VipGapItem[] // 不足項目（優先度順）
  summary:         string       // AIコメント
  nearestGoal:     VipGapItem | null  // 最も近い目標1件
}

export interface CustomerRiskProfile {
  churnProbability:   'low' | 'medium' | 'high'   // 離脱リスク
  returnLikelihood:   'low' | 'medium' | 'high'   // 再来可能性
  offerSuccessRate:   'low' | 'medium' | 'high'   // 提案成功率
  riskFactors:        string[]   // リスク要因ラベル
  positiveFactors:    string[]   // ポジティブ要因ラベル
}

/** 関係性ステート（数値感なし） */
export type RelationshipState =
  | 'forming'       // 関係形成中
  | 'growing'       // 深化中
  | 'stable'        // 安定
  | 'cooling'       // 温度低下
  | 'at_risk'       // 要フォロー

export const RELATIONSHIP_LABEL: Record<RelationshipState, string> = {
  forming:   '関係形成中',
  growing:   '深化中',
  stable:    '安定',
  cooling:   '温度が少し下がっています',
  at_risk:   '要フォロー',
}

export const RELATIONSHIP_EMOJI: Record<RelationshipState, string> = {
  forming:  '🌱',
  growing:  '🌸',
  stable:   '🌿',
  cooling:  '🍂',
  at_risk:  '⚠️',
}

/** 接客後サービスリプレイ */
export interface ServiceReplay {
  strengths:     string[]   // 良かった点
  suggestions:   string[]   // 次回改善
  timing:        string     // 提案タイミング評価
  flow:          string     // 会話の流れ評価
}

/** スタッフ強み分析 */
export interface StaffFlowProfile {
  offerStrength:   string   // 提案傾向
  lineStrength:    string   // LINE傾向
  repeatStrength:  string   // リピート傾向
  topTag:          string   // 最も得意な接客タイプ
}

/** 先回り提案（Predictive） */
export interface PredictiveSuggestion {
  id:          string
  horizon:     'soon' | 'future'   // soon=1週間以内 / future=1ヶ月以内
  title:       string
  description: string
  triggerReason: string
}

// ─── PHASE 8 ─────────────────────────────────────────────────────────────────

/** 成功パターン（店舗が蓄積した再来・購入・指名の共通導線） */
export type SuccessPattern = {
  id: string

  customerTags: string[]

  staffId: string

  actionType: ActionType

  actionContent: string

  outcome: {
    reVisitRate:  number
    lineReplyRate: number
    salesUp:      number
    successScore: number
  }

  context: {
    season?:            string
    concern?:           string[]
    insightTags?:       string[]
    relationshipState?: string
    visitCycle?:        number
  }

  timing?: {
    minutesAfterService?: number
    beforeCheckout?:      boolean
  }

  staffStyle?:
    | '共感型'
    | '提案型'
    | '分析型'
    | '癒し型'

  createdAt: string
}

/** スタッフスタイルプロファイル（強み・傾向の自然表現） */
export interface StaffStyleProfile {
  staffId:         string
  offerTiming:     string   // 「施術終盤に自然な流れで提案」等
  lineStyle:       string   // 「短文・絵文字あり・返信率高め」等
  repeatStrength:  string   // 「3〜5回来店後の定着率が高い」等
  topCustomerType: string   // 「感情重視型とのマッチが最多」等
  insight:         string   // ひとことスタイル説明
}

/** KPI 改善ヒント（数字でなく自然言語で） */
export interface KpiHint {
  kpiKey:    string
  direction: 'up' | 'down' | 'stable'
  hint:      string    // 「施術終盤での次回提案が増えると改善しやすいです」等
  urgency:   'low' | 'medium' | 'high'
}

/** Retrieval Suggestion（類似成功導線の参照） */
export interface RetrievalSuggestion {
  id:          string
  title:       string
  description: string
  basedOn:     string   // 「過去X件の類似ケースから」
  confidence:  number   // 0〜1
}

/** 店舗インテリジェンス */
export interface StoreIntelligence {
  topMenus:        string[]   // 売れ筋施術
  seasonalTrends:  string     // 季節傾向
  repeatPattern:   string     // リピートパターン説明
  offerWinRate:    string     // 提案成功傾向
  weeklyHint:      string     // 今週の改善ヒント
}

// ─── Adaptive Priority Engine（PHASE 10.1） ──────────────────────────────────────

export type SectionPriority = {
  level:   PriorityLevel
  score:   number        // 0〜100
  reasons: string[]      // 人間が読める理由（デバッグ・説明用）
}

export type SectionPriorities = Record<DisplaySection, SectionPriority>

// ─── Section Priority Engine（PHASE 8.5） ────────────────────────────────────

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'hidden'

export type DisplaySection =
  | 'aiInsight'
  | 'voiceMemo'
  | 'lineDraft'
  | 'nextAction'
  | 'timeline'
  | 'storeLearning'
  | 'serviceReplay'
  | 'homeCare'
  | 'homecare'               // adaptivePriority エンジン側の別名（homeCare と同義）
  | 'predictiveSuggestions'  // 先回り提案
  | 'riskCard'               // リスク・関係性カード

export type ServicePhase = 'counseling' | 'treatment' | 'aftercare' | 'checkout'

export interface ActiveSession {
  phase:        ServicePhase
  timePressure: boolean   // 次の予約まで30分以内など
}

// ─── customer_visits テーブル ────────────────────────────────────────────────

/** customer_visits テーブル行 */
export interface CustomerVisit {
  id:            string           // UUID
  customer_id:   string           // FK → customers.id
  visit_date:    string           // YYYY-MM-DD
  treatment:     string           // 施術名
  sales:         number           // 売上（円）
  retail_sales:  number           // 店販売上（円）
  staff_name:    string           // 担当者名
  has_next_rebook: boolean        // 次回予約あり
  is_designated:   boolean        // 指名あり
  source:        'salonboard_csv' | 'manual' | 'square'
  created_at:    string           // ISO datetime
}

/** customer_visits INSERT 用（id / created_at は DB 自動生成） */
export type CustomerVisitInsert = Omit<CustomerVisit, 'id' | 'created_at'>

// ─── AI改善フィードバックログ ─────────────────────────────────────────────────

export type CoachActionType  = 'rebook_proposal' | 'product_suggest' | 'vip_upgrade' | 'line_follow' | 'other'
export type ActionResultType = 'success' | 'fail' | 'pending'

export interface ImprovementActionLog {
  id:                        string
  staff_name:                string
  action_type:               CoachActionType
  customer_id:               string | null
  customer_name:             string
  metric:                    string
  created_at:                string
  completed_at:              string | null
  result_type:               ActionResultType | null
  revenue_generated:         number    // 予測売上
  revenue_generated_actual:  number | null  // 実売上（attribution後）
  attribution_linked_at:     string | null
  success:                   boolean
  notes:                     string | null
}

export type ImprovementActionLogInsert = Omit<ImprovementActionLog, 'id' | 'created_at'>

export interface ImprovementRevenueLink {
  id:            string
  action_log_id: string
  customer_id:   string | null
  visit_id:      string | null
  revenue:       number
  created_at:    string
}

export type ImprovementRevenueLinkInsert = Omit<ImprovementRevenueLink, 'id' | 'created_at'>

// ─── LINE ユーザー名寄せ ──────────────────────────────────────────────────────

export interface LineUserId {
  id:              string
  line_user_id:    string
  display_name:    string
  picture_url:     string | null
  customer_id:     string | null
  is_staff:        boolean
  staff_name:      string | null
  is_test_account: boolean
  followed_at:     string
  unfollowed_at:   string | null
  linked_at:       string | null
  created_at:      string
  updated_at:      string
}

// ─── LINE 送信キュー ──────────────────────────────────────────────────────────

export type LineSendMode   = 'test' | 'staff_notify' | 'semi' | 'auto'
export type LineSendStatus = 'pending' | 'approved' | 'sent' | 'failed' | 'skipped'

export interface LineSendQueue {
  id:            string
  customer_id:   string | null
  customer_name: string
  line_user_id:  string
  message_body:  string
  send_mode:     LineSendMode
  status:        LineSendStatus
  approved_by:   string | null
  approved_at:   string | null
  scheduled_at:  string | null
  triggered_by:  string | null
  template_id:   string | null
  error_message: string | null
  sent_at:       string | null
  created_at:    string
  updated_at:    string
}

// ─── SalonBoard CSV 取込 ──────────────────────────────────────────────────────

/** CSV 1行から抽出した生データ（PII除去済み） */
export interface SalonBoardRawRow {
  customerName:    string
  ageGroup?:       string        // 例: '30代'
  birthMonth?:     number        // 1〜12
  visitDate:       string        // YYYY-MM-DD
  sales:           number        // 売上（円）
  treatment:       string        // 施術名
  retailSales:     number        // 店販売上（円）
  staffName:       string        // 担当者名
  hasNextRebook:   boolean       // 次回予約あり
  isDesignated:    boolean       // 指名あり
}

/** 顧客単位に統合したデータ */
export interface SalonBoardCustomer {
  nameHash:        string        // SHA-256(顧客名) — 照合キー
  displayName:     string        // 表示用（苗字のみ or 匿名化）
  ageGroup?:       string
  birthMonth?:     number
  visits:          number
  totalSales:      number
  retailSales:     number
  avgSales:        number
  lastVisitDate:   string        // YYYY-MM-DD
  treatments:      string[]      // 利用施術リスト（ユニーク）
  assignedStaff:   string[]      // 担当スタッフリスト（ユニーク）
  hasRecentPurchase: boolean
  rebookCount:     number        // 次回予約回数
  designatedCount: number        // 指名回数
  designationRate: number        // 指名率 (0〜100)
  phase:           CustomerPhase
  score:           number        // CustomerScore (0〜100)
}

/** CSV取込結果 */
export interface SalonBoardImportResult {
  customers:    SalonBoardCustomer[]
  totalRows:    number           // 読み込んだ行数
  skippedRows:  number           // スキップ行数（ヘッダー・不正行）
  errors:       string[]         // 警告・エラーメッセージ
  importedAt:   string           // ISO datetime
}

/** CSVカラムマッピング設定 */
export interface SalonBoardColumnMap {
  customerName?:  string   // カラム名
  visitDate?:     string
  sales?:         string
  treatment?:     string
  retailSales?:   string
  staffName?:     string
  hasNextRebook?: string
  isDesignated?:  string
  ageGroup?:      string
  birthMonth?:    string
}

// ─── SalonBoard CSV 保存結果 ──────────────────────────────────────────────────

/** Supabase 保存結果 */
export interface SalonBoardSaveResult {
  customersCreated:  number
  customersUpdated:  number
  visitsInserted:    number
  errors:            string[]
  savedAt:           string   // ISO datetime
}

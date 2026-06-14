// ================================================================
// Riora Brain - ドメイン型定義 (単一ファイルで管理)
//
// DBは brain_ プレフィックス付きテーブル (例: brain_customers) で
// snake_case のカラムを持つが、TypeScript側はここで定義する
// camelCase のドメイン型を唯一の正とする。
// snake_case <-> camelCase の変換は src/services/ 配下のマッパーで
// 一元的に行うこと(engines/ 配下では行わない)。
// ================================================================

// === 基本enum(DB CHECKと完全一致させる。Claude Codeはこの定義を唯一の正とする) ===
export type CustomerType = 'A_acne' | 'B_pore' | 'C_sensitive' | 'D_aging' | 'E_bridal';
export type StaffStyle = 'evidence' | 'theory' | 'empathy';
export type ProposalKind = 'homecare' | 'rebooking' | 'subscription' | 'upsell' | 'pack' | 'none';
export type MenuRole = 'entry' | 'pore' | 'sensitive' | 'peeling' | 'lifting';
export type NoBookingReason = 'considering' | 'unsure' | 'cold';
export type RevisionStatus = 'proposed' | 'approved' | 'rejected' | 'auto_applied';
export type PatternOrigin = 'manual' | 'ai_discovered' | 'brain_install';

// === Pattern Engine共通enum (Success Pattern Final Architecture v1.0) ===
export type UUID = string;
export type LifecycleStatus = 'candidate' | 'testing' | 'active' | 'watch' | 'demoted' | 'suspended';
export type FeatureName =
  | 'timing_proximity'
  | 'cycle_position'
  | 'condition_margin'
  | 'type_confidence'
  | 'csi_alignment'
  | 'skin_momentum';

// === Row型(テーブルと1:1。Supabase生成型があればextendsで整合) ===
export interface Store {
  id: string;
  name: string;
  anonId: string;
  anonSalt: string;
  cluster: string;
  priceTier: string;
  brainSubscription: boolean;
  learningMode: boolean;
}

export interface Customer {
  id: string;
  storeId: string;
  name: string;
  ageGroup: string | null;
  customerType: CustomerType | null;
  typeConfidence: number;
  goalNote: string | null;
  weddingDate: string | null;
  acquisitionChannel: string | null;
  firstVisitDate: string | null;
  assignedStaffId: string | null;
  isSubscriber: boolean;
  subscribedAt: string | null;
  churnScore: number;
  churnReason: string | null;
  consentAnonymizedLearning: boolean;
}

export interface Staff {
  id: string;
  storeId: string;
  name: string;
  style: StaffStyle;
  isActive: boolean;
}

export interface Menu {
  id: string;
  storeId: string;
  name: string;
  price: number;
  role: MenuRole;
  targetTypes: CustomerType[];
}

export interface Booking {
  id: string;
  storeId: string;
  customerId: string;
  staffId: string;
  bookingDate: string;
  source: 'in_salon' | 'line' | 'hotpepper' | 'web';
  status: 'active' | 'done' | 'cancelled' | 'noshow';
}

export interface Subscription {
  id: string;
  storeId: string;
  customerId: string;
  planName: string;
  monthlyPrice: number;
  startedAt: string;
  cancelledAt: string | null;
  cancelReason: 'no_effect' | 'price' | 'distance' | 'other' | null;
}

export interface Visit {
  id: string;
  storeId: string;
  customerId: string;
  staffId: string;
  menuId: string;
  visitDate: string;
  visitCountAt: number;
  isNomination: boolean;
  treatmentAmount: number;
  retailAmount: number;
  retailCategory: string | null;
  homecarePurchased: boolean;
  homecareDeclined: boolean;
  nextBookingMade: boolean;
  noBookingReason: NoBookingReason | null;
  voiceMemoUrl: string | null;
  visitScore: number;
}

export interface SkinRecord {
  id: string;
  customerId: string;
  visitId: string;
  acneLevel: number | null;
  poreLevel: number | null;
  drynessLevel: number | null;
  rednessLevel: number | null;
  saggingLevel: number | null;
  dullnessLevel: number | null;
  firmnessLevel: number | null;
  primaryDelta: number | null;
}

export interface BusinessSettings {
  storeId: string;
  month: string;
  salesTarget: number;
  fixedCosts: number | null;
  variableCostRate: number;
}

export interface SuccessPattern {
  id: string;
  storeId: string | null;
  customerType: CustomerType;
  label: string;
  entryCondition: JsonLogicRule;
  targetCycleDays: number;
  version: number;
  isActive: boolean;
  origin: PatternOrigin;
  lifecycleStatus: LifecycleStatus;
  lifecycleChangedAt: string | null;
}

export interface PatternStep {
  id: string;
  patternId: string;
  stepNo: number;
  label: string;
  proposalKind: ProposalKind;
  menuRole: MenuRole | null;
  fireCondition: JsonLogicRule;
  baseScript: string;
  cooldownVisits: number;
  softFeatures: SoftFeatureSpec;
  optimalVisit: number | null;
}

export interface PatternProgress {
  customerId: string;
  patternId: string;
  patternVersion: number;
  currentStep: number;
  enteredAt: string;
  stepAdvancedAt: string | null;
  stalledFlag: boolean;
  completed: boolean;
  abandonedReason: string | null;
  assignScore: number | null;
  switchCandidate: string | null;
  switchStreak: number;
}

export interface StaffAdjustment {
  staffId: string;
  patternId: string;
  proposalKind: ProposalKind;
  timingOffset: number;
  scriptStyle: StaffStyle | null;
  affinityScore: number | null;
}

export interface ProposalOutcome {
  id: string;
  storeId: string;
  customerId: string;
  visitId: string;
  staffId: string;
  patternId: string;
  stepNo: number;
  proposalKind: ProposalKind;
  visitCountAt: number;
  wasBriefed: boolean;
  wasExecuted: boolean;
  wasAccepted: boolean;
  amount: number;
  customerType: CustomerType;
  staffStyle: StaffStyle;
  fireScore: number | null;
  decisiveFactor: string | null;
}

export interface PatternRevision {
  id: string;
  storeId: string;
  patternId: string;
  changeType: 'timing' | 'condition' | 'script' | 'new_pattern' | 'churn_weights' | 'staff_adjustment';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: RevisionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
}

// === エンジン入出力型 ===
export type JsonLogicRule = Record<string, unknown>;

export interface PatternContext {
  visitCount: number;
  daysSinceLast: number;
  avgCycle: number;
  isNominationStreak2: boolean;
  homecarePurchasedEver: boolean;
  homecareDeclinedRecent: boolean;
  skinImproved: boolean;
  skinStagnant2: boolean;
  subscConditionsMet: 0 | 1 | 2 | 3 | 4;
  churnScore: number;
  nextBookingMadeLast: boolean;
  weddingDaysLeft: number | null;
  retailTotal: number;
  // Soft特徴の生値(PatternScorerが0-1へ正規化する)
  raw: {
    typeConfidence: number;
    csi: number;
    skinDeltaTrend: number;
    cycleRatio: number;
    lastVisitDate: string;
  };
  customerType: CustomerType;
  customerId: UUID;
  storeId: UUID;
}

export interface IntakeForm {
  concerns: string[];
  weddingPlanned: boolean;
  weddingDate?: string;
  currentHomecare: string;
  channel: string;
  goalNote?: string;
  consent: boolean;
}

export interface ClassificationResult {
  type: CustomerType;
  confidence: number;
}

export interface ChurnResult {
  score: number;
  level: 'safe' | 'warning' | 'danger';
  reason: string | null;
  recommendedAction: string | null;
}

export interface FiredProposal {
  customerId: string;
  candidateCode: string;
  patternId: string;
  stepNo: number;
  proposalKind: ProposalKind;
  baseScript: string;
  adjustedScript: string;
  scriptStyle: StaffStyle;
  priority: number;
  isMandatory: boolean;
  fireScore: number;
  decisiveFactor: string | null;
}

export interface Briefing {
  customerId: string;
  customerName: string;
  type: CustomerType;
  patternLabel: string;
  patternStep: string;
  todayGoal: string;
  talkHint: string;
  avoidNote: string | null;
  successReference: string | null;
  proposals: FiredProposal[];
}

export interface VisitInput {
  /* saveVisitRecordの引数。入力設計v1.0 ⑩と一致 */
  customerId: string;
  staffId: string;
  menuId: string;
  isNomination: boolean;
  retailAmount?: number;
  retailCategory?: string;
  homecarePurchased: boolean;
  homecareDeclined?: boolean;
  nextBookingMade: boolean;
  noBookingReason?: NoBookingReason;
  nextDate?: string;
  nextStaffId?: string;
  voiceMemoUrl?: string;
  skinLevels: Partial<Record<'acne' | 'pore' | 'dryness' | 'redness' | 'sagging' | 'dullness' | 'firmness', number>>;
}

// ================================================================
// Pattern Engine (Success Pattern Final Architecture v1.0 /
// Proposal Generator Architecture v2.0)
//
// 店内提案(in_store)スコープのみ。brain_scenarios/scenario_outcomes/
// scenario_trigger_log(DM側)は後続実装のため、QueuedScenario等は
// 最小限のスタブ型のみ定義する。
// ================================================================

// === 候補(店内step/DMシナリオの統一表現) ===
export interface SoftFeatureSpec {
  weights: Partial<Record<FeatureName, number>>;
  optimalVisit?: number;
}

export interface Candidate {
  uid: UUID;
  code: string; // 'B1-step4' | 'S-SB-07'
  channel: 'in_store' | 'dm';
  patternCode: string | null; // 店内のみ
  stepNo: number | null;
  proposalKind: ProposalKind;
  isSales: boolean;
  priorityClass: 1 | 2 | 3 | 4;
  hardCondition: JsonLogicRule;
  softFeatures: SoftFeatureSpec;
  baseScript: string;
  cooldownVisits: number;
  lifecycleStatus: LifecycleStatus;
  version: number;
}

// === パイプライン中間型 ===
export type StageReached = 0 | 1 | 2 | 3 | 4;
export type BlockedByReason =
  | 'lifecycle'
  | 'condition'
  | 'G-SUB'
  | 'G-CHURN'
  | 'G-COOL'
  | 'G-FREQ'
  | 'G-CONSENT'
  | 'exclusion'
  | 'score'
  | 'slot';

export interface RejectedCandidate {
  candidate: Candidate;
  stageReached: StageReached;
  blockedBy: BlockedByReason;
  detail?: string;
}

export interface ScoreBreakdown {
  successRate: number;
  contextFit: number;
  timing: number;
  affinity: number;
  urgency: number;
  overrideBoost: number;
  churnPenalty: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  features: Record<FeatureName, number>; // 0-1
  breakdown: ScoreBreakdown; // 各項は重み適用後の寄与値
  fireScore: number; // 0-100
}

export interface Resolution {
  inStore: { mandatory: ScoredCandidate | null; secondary: ScoredCandidate | null };
  dm: ScoredCandidate | null;
  rejected: RejectedCandidate[];
  tiebreakUsed: boolean;
}

// === 統計・パラメータ(Repository経由) ===
export type CellKey = string; // `${candidate.code}:${customerType}:${staffStyle}`

export interface CellStats {
  executedN: number;
  acceptedN: number;
  laplaceRate: number;
  repeatRate90d: number | null;
}

export interface ScoringWeights {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  w5: number;
}

export interface Overrides {
  manualPin: { candidateCode: string } | null; // O1
  storeOverrideCodes: Set<string>; // O2
}

// === StaffAdjustmentEngine ===
export interface AffinityResolved {
  style: StaffStyle;
  perKind: Map<ProposalKind, number>; // 0-1(実測EWMA優先・なければstyle_affinity prior)
  timingOffsets: Map<string, number>; // `${patternCode}:${kind}` -> offset(visit_count加算)
  constraints: {
    mandatoryMax: number; // 亀山=1(他=1。将来可変)
    subscriptionStyle?: 'document_handover'; // 外舘C型固定
  };
}

// === ConflictResolver.resolveAssignment (Final v1.0 2-3 ケース1) ===
export interface AssignmentDecision {
  patternId: string; // この評価で採用するパターン
  assignScore: number;
  switched: boolean; // この評価で切替が発生したか
  abandonedPatternId: string | null; // 切替時、abandoned_reason='pattern_switched'でクローズする旧パターン
  switchCandidate: string | null; // brain_pattern_progress.switch_candidateへ永続化
  switchStreak: number; // brain_pattern_progress.switch_streakへ永続化
}

// === PatternMatcher ===
export interface OutcomeLite {
  patternId: string;
  stepNo: number;
  proposalKind: ProposalKind;
  visitCountAt: number;
  wasExecuted: boolean;
  wasAccepted: boolean;
  occurredAt: string;
}

export interface MatchInput {
  candidates: Candidate[];
  ctx: PatternContext;
  recentOutcomes: OutcomeLite[];
  consentDm: boolean;
  nowJst: string;
}

export interface MatchResult {
  eligible: Candidate[];
  rejected: RejectedCandidate[];
}

// === ExplainabilityEngine (Final v1.0 4-1 DecisionRecord) ===
export interface ScoreBreakdownRecord {
  success_rate: number;
  context_fit: number;
  timing: number;
  affinity: number;
  urgency: number;
  override_boost: number;
  final: number;
}

export interface DecisionCandidateRecord {
  candidateId: string;
  kind: ProposalKind;
  stageReached: StageReached;
  hardGates: { passed: string[]; failed: BlockedByReason | null };
  scoreBreakdown: ScoreBreakdownRecord | null;
  decisiveFactor: string | null; // 採用候補: breakdown最大寄与項 / 不採用: blockedBy
  marginToWinner: number | null; // 採用候補とのスコア差(不採用側)
}

export interface DecisionRecord {
  candidates: DecisionCandidateRecord[];
  resolution: { winner: string[]; stage4TiebreakUsed: boolean };
  contextSnapshot: PatternContext;
}

export interface ExplainTexts {
  staffLine1: string; // なぜ今日か
  staffAvoid: string | null; // 避けること
  managerQ1: string; // なぜ発火したか
  managerQ2: string; // なぜ他候補を落としたか
  managerQ3: string; // 何が決定打か
}

// === NextActionGenerator (Proposal Generator v2.0 §4) ===
export interface Action {
  text: string; // 合成済台本
  kind: ProposalKind | 'rebooking' | 'memo_review' | 'reminder';
  evidence1Line: string; // なぜ今日か
  checklistKey: string;
}

export interface NextActionPlan {
  bookingId: string | null;
  slots: {
    before: Action[];
    during: Action[];
    closing: Action[];
    after: Action[];
  };
  mandatoryKind: ProposalKind | null;
  candidateDates: string[]; // 第1候補+代替2日(rebooking勝者がない場合は空)
}

// === HomeCareGenerator (v2.0 §5) ===
export interface HomeCarePlan {
  category: string;
  priceBand: { min: number; max: number };
  scriptVars: {
    categoryLabel: string;
    reasonOneLine: string;
    cautionNote: string | null;
  };
}

// === LineScenarioConnector (v2.0 §6・stub) ===
export interface QueuedScenario {
  scenarioId: string;
  customerId: string;
  proposalKind: ProposalKind;
  status: 'pending' | 'blocked';
  blockedBy?: 'superseded_by_instore';
}

// === ProposalOrchestrator 出力契約 (v2.0 §2) ===
export interface FinalProposalSet {
  inStore: {
    mandatory: FiredProposal | null; // 1件のみ(スコア1位)
    secondary: FiredProposal | null; // 非販売のみ充当可
    candidateDate: string | null; // rebooking用の次回候補日(NextActionGeneratorが算出)
  };
  dm: QueuedScenario | null;
  explanation: ExplainTexts;
  decisionRecordId: UUID | null;
}

export interface ContextBundle {
  customer: Customer;
  visits: Visit[];
  skinRecords: SkinRecord[];
  progress: PatternProgress | null;
  subscription: Subscription | null;
  recentOutcomes: OutcomeLite[];
  staff: Staff;
  todaysBookings: Booking[];
  nowJst: string;
}

export interface EngineDegradedResult {
  degraded: true;
  reason: string;
  proposal: FinalProposalSet; // 空提案+explanation定型文
}

/** Resolver出口の不変条件違反(v2.0 §2)。バグ検知用・catchして握り潰さないこと。 */
export class EngineInvariantError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineInvariantError';
  }
}

// ================================================================
// Repository層: Scenario / LineQueue 契約型 (Repository & RPC Layer v1.0)
//
// src/engines/scenario/ScenarioSelector.ts / ScenarioQueueBuilder.ts が
// 自己完結型として定義する同名shapeと構造的に一致させること(相互変換
// 不要・構造的部分型でそのまま受け渡しできる)。ScenarioRepo/LineQueueRepo
// の戻り値・引数として使用する。
// ================================================================

export type ScenarioPriority = 'critical' | 'high' | 'medium' | 'low';
export type ScenarioChannel = 'LINE' | 'SMS' | 'EMAIL';

/** brain_scenarios(+送信履歴)から取得するDM候補1件。ScenarioSelector.ScenarioCandidateRowと構造的に同一。 */
export interface ScenarioCandidateRow {
  scenarioCode: string;
  priority: ScenarioPriority;
  customerType: CustomerType;
  channel: ScenarioChannel;
  updatedAt: string;
  /** 同一scenarioの直近送信日時(brain_line_send_queue.status='sent')。未送信はnull。 */
  lastSentAt: string | null;
}

export type LineQueueApprovalStatus = 'pending';

/** ScenarioQueueBuilderの出力契約。LineQueueRepo.enqueue()の入力。ScenarioQueueBuilder.LineSendQueuePayloadと構造的に同一。 */
export interface LineSendQueuePayload {
  customer_id: UUID;
  store_id: UUID;
  scenario_code: string;
  template_id: string;
  scheduled_at: string;
  approval_status: LineQueueApprovalStatus;
}

export type LineQueueStatus = 'pending' | 'approved' | 'sent' | 'rejected';

/** brain_line_send_queueの1行(camelCase)。LineQueueRepo.listPendingByStore()の戻り値。 */
export interface LineQueueItem {
  id: UUID;
  storeId: UUID;
  customerId: UUID;
  scenarioCode: string;
  templateId: string | null;
  scheduledAt: string | null;
  approvalStatus: LineQueueStatus;
  createdAt: string;
}

// ================================================================
// Repository層: Dashboard / Briefing / Revision 契約型 (P0 API Layer v1.0)
// ================================================================

/** brain_dashboard_dailyの最新スナップショット1件(camelCase)。GetDashboardの戻り値。 */
export interface DashboardSnapshot {
  storeId: UUID;
  snapshotDate: string;
  monthlySales: number;
  forecastSales: number;
  breakevenPoint: number | null;
  repeatRate90d: number | null;
  rebookingRate: number | null;
  homecareRate: number | null;
  segmentMatrix: Record<string, unknown>;
  funnel: Record<string, unknown>;
  staffMatrix: Record<string, unknown>;
  aiInsights: unknown[];
}

/**
 * brain_pattern_fire_logの直近1件(+brain_customers.name)をcamelCaseで返す。
 * GetBriefingの戻り値(P0簡易版): patternLabel/todayGoal/talkHint等を含む完全な
 * Briefing型はpattern_library結合とEngine層の文言生成を要するため、本Stepでは
 * decision_record(DecisionRecord)とexplanationをそのまま返す。
 */
export interface BriefingEntry {
  id: UUID;
  customerId: UUID;
  customerName: string;
  visitId: UUID | null;
  decisionRecord: DecisionRecord;
  explanation: string;
  createdAt: string;
}

export type RevisionScope = 'store' | 'brand';

/**
 * brain_pattern_revisions(scope='store') / brain_revisions(scope='brand')の1行
 * (camelCase)。RevisionRepo.approve()の戻り値。
 */
export interface RevisionRecord {
  id: UUID;
  scope: RevisionScope;
  /** scope='brand'の場合はnull(ブランド横断改訂)。 */
  storeId: UUID | null;
  patternId: string;
  changeType: 'timing' | 'condition' | 'script' | 'new_pattern' | 'churn_weights' | 'staff_adjustment';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: RevisionStatus;
  decidedBy: UUID | null;
  decidedAt: string | null;
  createdAt: string;
}

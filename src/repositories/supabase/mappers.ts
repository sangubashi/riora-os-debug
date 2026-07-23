// ================================================================
// Pattern Engine Repository - snake_case(DB行) → camelCase(domain型) 変換
//
// DBはsnake_case・TSドメイン型(src/types/riora.types, brain.types)は
// camelCase。変換はこのファイルに集約し、engines/には生のDB行を渡さない。
// ================================================================

import type {
  AIInsight,
  BriefingEntry,
  BusinessSettings,
  Candidate,
  CellKey,
  CellStats,
  CustomerType,
  Customer,
  DashboardSnapshot,
  DecisionRecord,
  JsonLogicRule,
  LifecycleStatus,
  LineQueueItem,
  LineQueueStatus,
  LineSendQueuePayload,
  Menu,
  MenuRole,
  NoBookingReason,
  OpsLog,
  OutcomeLite,
  ProposalKind,
  RevisionRecord,
  RevisionScope,
  RevisionStatus,
  ScenarioCandidateRow,
  ScenarioChannel,
  ScenarioPriority,
  ScoringWeights,
  SoftFeatureSpec,
  Staff,
  StaffStyle,
  Store,
  Subscription,
  Visit,
  VisitSource,
} from '../../types/riora.types';
import type { StyleAffinityTable, BrainEvent, BrainEventType } from '../../types/brain.types';

const SALES_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>(['homecare', 'subscription', 'upsell', 'pack']);

/**
 * Success Pattern Final v1.0 1-2 Urgency項({1:1.0,2:0.7,3:0.4,4:0.2})のpriorityClass。
 * brain_pattern_stepsに専用列が無いため、proposal_kindから暫定導出する(Step3作業仮定)。
 */
const PRIORITY_CLASS_BY_KIND: Record<ProposalKind, 1 | 2 | 3 | 4> = {
  subscription: 1,
  rebooking: 2,
  homecare: 3,
  upsell: 3,
  pack: 4,
  none: 4,
};

// === brain_success_patterns × brain_pattern_steps → Candidate[] ===

export interface PatternStepRow {
  id: string;
  step_no: number;
  proposal_kind: ProposalKind;
  fire_condition: JsonLogicRule;
  base_script: string;
  cooldown_visits: number;
  soft_features: { weights?: SoftFeatureSpec['weights'] } | null;
  optimal_visit: number | null;
}

export interface SuccessPatternRow {
  id: string;
  lifecycle_status: LifecycleStatus;
  version: number;
  customer_type: CustomerType | null;
  brain_pattern_steps: PatternStepRow[];
}

export function toCandidate(pattern: SuccessPatternRow, step: PatternStepRow): Candidate {
  const softFeatures: SoftFeatureSpec = {
    weights: step.soft_features?.weights ?? {},
    ...(step.optimal_visit != null ? { optimalVisit: step.optimal_visit } : {}),
  };

  return {
    uid: step.id,
    code: `${pattern.id}-step${step.step_no}`,
    channel: 'in_store',
    patternCode: pattern.id,
    stepNo: step.step_no,
    customerType: pattern.customer_type ?? null,
    proposalKind: step.proposal_kind,
    isSales: SALES_KINDS.has(step.proposal_kind),
    priorityClass: PRIORITY_CLASS_BY_KIND[step.proposal_kind],
    hardCondition: step.fire_condition,
    softFeatures,
    baseScript: step.base_script,
    cooldownVisits: step.cooldown_visits,
    lifecycleStatus: pattern.lifecycle_status,
    version: pattern.version,
  };
}

export function toCandidates(pattern: SuccessPatternRow): Candidate[] {
  return pattern.brain_pattern_steps.map((step) => toCandidate(pattern, step));
}

// === brain_pattern_step_stats(マテビュー) → CellStats ===

export interface PatternStepStatsRow {
  candidate_code: string;
  customer_type: string;
  staff_style: string;
  executed_n: number;
  accepted_n: number;
  laplace_rate: number | string;
  repeat_rate_90d: number | string | null;
}

export function cellKeyOf(row: Pick<PatternStepStatsRow, 'candidate_code' | 'customer_type' | 'staff_style'>): CellKey {
  return `${row.candidate_code}:${row.customer_type}:${row.staff_style}`;
}

export function toCellStats(row: PatternStepStatsRow): CellStats {
  return {
    executedN: row.executed_n,
    acceptedN: row.accepted_n,
    laplaceRate: Number(row.laplace_rate),
    repeatRate90d: row.repeat_rate_90d == null ? null : Number(row.repeat_rate_90d),
  };
}

// === brain_params.value → ScoringWeights / StyleAffinityTable ===
// シード(20260612000008)のvalueはcamelCase互換キー({w1..w5} / {evidence:{homecare:..}})で
// 格納されているため、フィールド単位の変換は不要(JSONBの形をそのまま信頼する)。

export function toScoringWeights(value: unknown): ScoringWeights {
  return value as ScoringWeights;
}

export function toStyleAffinityTable(value: unknown): StyleAffinityTable {
  return value as StyleAffinityTable;
}

// === brain_proposal_outcomes → OutcomeLite ===

export interface ProposalOutcomeRow {
  pattern_id: string;
  step_no: number;
  proposal_kind: ProposalKind;
  visit_count_at: number;
  was_executed: boolean;
  was_accepted: boolean;
  created_at: string;
}

export function toOutcomeLite(row: ProposalOutcomeRow): OutcomeLite {
  return {
    patternId: row.pattern_id,
    stepNo: row.step_no,
    proposalKind: row.proposal_kind,
    visitCountAt: row.visit_count_at,
    wasExecuted: row.was_executed,
    wasAccepted: row.was_accepted,
    occurredAt: row.created_at,
  };
}

// === brain_customers → Customer ===

export interface BrainCustomerRow {
  id: string;
  store_id: string;
  name: string;
  age_group: string | null;
  customer_type: CustomerType | null;
  type_confidence: number | string;
  goal_note: string | null;
  wedding_date: string | null;
  acquisition_channel: string | null;
  first_visit_date: string | null;
  assigned_staff_id: string | null;
  is_subscriber: boolean;
  subscribed_at: string | null;
  churn_score: number | string;
  churn_reason: string | null;
  consent_anonymized_learning: boolean;
  prefecture?: string | null;
  city?: string | null;
  external_key_hash?: string | null;
}

export function toCustomer(row: BrainCustomerRow): Customer {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    ageGroup: row.age_group,
    customerType: row.customer_type,
    typeConfidence: Number(row.type_confidence),
    goalNote: row.goal_note,
    weddingDate: row.wedding_date,
    acquisitionChannel: row.acquisition_channel,
    firstVisitDate: row.first_visit_date,
    assignedStaffId: row.assigned_staff_id,
    isSubscriber: row.is_subscriber,
    subscribedAt: row.subscribed_at,
    churnScore: Number(row.churn_score),
    churnReason: row.churn_reason,
    consentAnonymizedLearning: row.consent_anonymized_learning,
    prefecture: row.prefecture ?? null,
    city: row.city ?? null,
    externalKeyHash: row.external_key_hash ?? null,
  };
}

/** CSV取込で新規brain_customers行を作るためのinsert行(snake_case)。 */
export function toBrainCustomerInsert(input: {
  storeId: string;
  name: string;
  ageGroup: string | null;
  firstVisitDate: string | null;
  prefecture: string | null;
  city: string | null;
  externalKeyHash: string | null;
}): Record<string, unknown> {
  return {
    store_id: input.storeId,
    name: input.name,
    age_group: input.ageGroup,
    first_visit_date: input.firstVisitDate,
    prefecture: input.prefecture,
    city: input.city,
    external_key_hash: input.externalKeyHash,
    consent_anonymized_learning: false,
  };
}

// === brain_visits ↔ Visit ===

export interface BrainVisitRow {
  id: string;
  store_id: string;
  customer_id: string;
  staff_id: string;
  menu_id: string;
  visit_date: string;
  visit_count_at: number;
  is_nomination: boolean;
  treatment_amount: number;
  retail_amount: number;
  retail_category: string | null;
  homecare_purchased: boolean;
  homecare_declined: boolean;
  next_booking_made: boolean;
  no_booking_reason: NoBookingReason | null;
  voice_memo_url: string | null;
  visit_score: number;
  source?: VisitSource;
}

export function toVisit(row: BrainVisitRow): Visit {
  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id,
    staffId: row.staff_id,
    menuId: row.menu_id,
    visitDate: row.visit_date,
    visitCountAt: row.visit_count_at,
    isNomination: row.is_nomination,
    treatmentAmount: row.treatment_amount,
    retailAmount: row.retail_amount,
    retailCategory: row.retail_category,
    homecarePurchased: row.homecare_purchased,
    homecareDeclined: row.homecare_declined,
    nextBookingMade: row.next_booking_made,
    noBookingReason: row.no_booking_reason,
    voiceMemoUrl: row.voice_memo_url,
    visitScore: row.visit_score,
    ...(row.source !== undefined ? { source: row.source } : {}),
  };
}

/** Visit(idなし) → brain_visits insert行(snake_case)。 */
export function toBrainVisitInsert(visit: Omit<Visit, 'id'>): Record<string, unknown> {
  return {
    store_id: visit.storeId,
    customer_id: visit.customerId,
    staff_id: visit.staffId,
    menu_id: visit.menuId,
    visit_date: visit.visitDate,
    visit_count_at: visit.visitCountAt,
    is_nomination: visit.isNomination,
    treatment_amount: visit.treatmentAmount,
    retail_amount: visit.retailAmount,
    retail_category: visit.retailCategory,
    homecare_purchased: visit.homecarePurchased,
    homecare_declined: visit.homecareDeclined,
    next_booking_made: visit.nextBookingMade,
    no_booking_reason: visit.noBookingReason,
    voice_memo_url: visit.voiceMemoUrl,
    visit_score: visit.visitScore,
    ...(visit.source !== undefined ? { source: visit.source } : {}),
  };
}

/** CSV取込が既存visit(staff_input由来)をreconciledへ突合更新するためのpatch行(snake_case)。 */
export function toBrainVisitReconcileUpdate(input: {
  staffId: string;
  menuId: string;
  isNomination: boolean;
  treatmentAmount: number;
  retailAmount: number;
}): Record<string, unknown> {
  return {
    staff_id: input.staffId,
    menu_id: input.menuId,
    is_nomination: input.isNomination,
    treatment_amount: input.treatmentAmount,
    retail_amount: input.retailAmount,
    source: 'reconciled' satisfies VisitSource,
  };
}

// === brain_scenarios(+brain_line_send_queue送信履歴) → ScenarioCandidateRow ===

export interface BrainScenarioRow {
  id: string;
  priority: ScenarioPriority;
  customer_type: CustomerType;
  channel: ScenarioChannel;
  updated_at: string;
}

export function toScenarioCandidateRow(row: BrainScenarioRow, lastSentAt: string | null): ScenarioCandidateRow {
  return {
    scenarioCode: row.id,
    priority: row.priority,
    customerType: row.customer_type,
    channel: row.channel,
    updatedAt: row.updated_at,
    lastSentAt,
  };
}

export interface BrainSentScenarioRow {
  trigger_type: string;
  created_at: string;
}

/** brain_line_send_queue(status='sent')の行群から、trigger_type別の最新created_atをMapにする。 */
export function toLastSentMap(rows: BrainSentScenarioRow[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    const existing = result.get(row.trigger_type);
    if (existing === undefined || row.created_at > existing) {
      result.set(row.trigger_type, row.created_at);
    }
  }
  return result;
}

// === LineSendQueuePayload ↔ brain_line_send_queue ===

/** LineSendQueuePayload(ScenarioQueueBuilder出力) → brain_line_send_queue insert行(snake_case)。 */
export function toBrainLineSendQueueInsert(payload: LineSendQueuePayload): Record<string, unknown> {
  return {
    store_id: payload.store_id,
    customer_id: payload.customer_id,
    trigger_type: payload.scenario_code,
    template_id: payload.template_id,
    scheduled_at: payload.scheduled_at,
    status: payload.approval_status,
    message_draft: '',
  };
}

export interface BrainLineQueueRow {
  id: string;
  store_id: string;
  customer_id: string;
  trigger_type: string;
  template_id: string | null;
  scheduled_at: string | null;
  status: LineQueueStatus;
  created_at: string;
}

export function toLineQueueItem(row: BrainLineQueueRow): LineQueueItem {
  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id,
    scenarioCode: row.trigger_type,
    templateId: row.template_id,
    scheduledAt: row.scheduled_at,
    approvalStatus: row.status,
    createdAt: row.created_at,
  };
}

// === brain_events ↔ BrainEvent ===

export interface BrainEventRow {
  id: string;
  store_anon_id: string;
  customer_hash: string;
  event_type: BrainEventType;
  customer_type: CustomerType | null;
  staff_style: StaffStyle | null;
  proposal_kind: ProposalKind | null;
  was_accepted: boolean | null;
  occurred_on: string;
  visit_count_at: number;
  amount_band: string | null;
  payload: Record<string, unknown>;
}

export function toBrainEvent(row: BrainEventRow): BrainEvent {
  return {
    id: row.id,
    storeAnonId: row.store_anon_id,
    customerHash: row.customer_hash,
    eventType: row.event_type,
    customerType: row.customer_type,
    staffStyle: row.staff_style,
    proposalKind: row.proposal_kind,
    wasAccepted: row.was_accepted,
    occurredOn: row.occurred_on,
    visitCountAt: row.visit_count_at,
    amountBand: row.amount_band,
    payload: row.payload,
  } as BrainEvent;
}

/** BrainEvent(idなし) → brain_events insert行(snake_case)。 */
export function toBrainEventInsert(event: Omit<BrainEvent, 'id'>): Record<string, unknown> {
  return {
    store_anon_id: event.storeAnonId,
    customer_hash: event.customerHash,
    event_type: event.eventType,
    customer_type: event.customerType,
    staff_style: event.staffStyle,
    proposal_kind: event.proposalKind,
    was_accepted: event.wasAccepted,
    occurred_on: event.occurredOn,
    visit_count_at: event.visitCountAt,
    amount_band: event.amountBand,
    payload: event.payload,
  };
}

// === brain_dashboard_daily → DashboardSnapshot ===

export interface BrainDashboardRow {
  store_id: string;
  snapshot_date: string;
  monthly_sales: number;
  forecast_sales: number;
  breakeven_point: number | null;
  repeat_rate_90d: number | string | null;
  rebooking_rate: number | string | null;
  homecare_rate: number | string | null;
  segment_matrix: Record<string, unknown>;
  funnel: Record<string, unknown>;
  staff_matrix: Record<string, unknown>;
  ai_insights: unknown[];
  dm_to_booking_rate: number | string | null;
  repeat_30: number | string | null;
  repeat_60: number | string | null;
  repeat_90: number | string | null;
  new_ratio: number | string | null;
  nomination_rate: number | string | null;
  month_profit_est: number | null;
  vip_customer_ids: string[];
  relation_triggers: Record<string, unknown>;
  occupancy: Record<string, unknown>;
  visit_count: number | null;
}

/** DashboardDailyUpsertInput → brain_dashboard_daily upsert行(snake_case)。 */
export function toBrainDashboardDailyUpsert(input: {
  storeId: string;
  snapshotDate: string;
  monthlySales: number;
  forecastSales: number;
  breakevenPoint: number | null;
  monthProfitEst: number | null;
  visitCount: number;
  repeat30: number | null;
  repeat60: number | null;
  repeat90: number | null;
  nominationRate: number | null;
  aiInsights?: AIInsight[];
}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    store_id: input.storeId,
    snapshot_date: input.snapshotDate,
    monthly_sales: input.monthlySales,
    forecast_sales: input.forecastSales,
    breakeven_point: input.breakevenPoint,
    month_profit_est: input.monthProfitEst,
    visit_count: input.visitCount,
    repeat_30: input.repeat30,
    repeat_60: input.repeat60,
    repeat_90: input.repeat90,
    nomination_rate: input.nominationRate,
  };
  // aiInsights未指定の場合はai_insights列をSETしない(既存値を保持する・他のW19列と同じ方針)。
  if (input.aiInsights !== undefined) row.ai_insights = input.aiInsights;
  return row;
}

export function toDashboardSnapshot(row: BrainDashboardRow): DashboardSnapshot {
  return {
    storeId: row.store_id,
    snapshotDate: row.snapshot_date,
    monthlySales: row.monthly_sales,
    forecastSales: row.forecast_sales,
    breakevenPoint: row.breakeven_point,
    repeatRate90d: row.repeat_rate_90d === null ? null : Number(row.repeat_rate_90d),
    rebookingRate: row.rebooking_rate === null ? null : Number(row.rebooking_rate),
    homecareRate: row.homecare_rate === null ? null : Number(row.homecare_rate),
    segmentMatrix: row.segment_matrix,
    funnel: row.funnel,
    staffMatrix: row.staff_matrix,
    aiInsights: row.ai_insights,
    dmToBookingRate: row.dm_to_booking_rate === null ? null : Number(row.dm_to_booking_rate),
    repeat30: row.repeat_30 === null ? null : Number(row.repeat_30),
    repeat60: row.repeat_60 === null ? null : Number(row.repeat_60),
    repeat90: row.repeat_90 === null ? null : Number(row.repeat_90),
    newRatio: row.new_ratio === null ? null : Number(row.new_ratio),
    nominationRate: row.nomination_rate === null ? null : Number(row.nomination_rate),
    monthProfitEst: row.month_profit_est,
    visitCount: row.visit_count,
    vipCustomerIds: row.vip_customer_ids,
    relationTriggers: row.relation_triggers,
    occupancy: row.occupancy,
  };
}

// === brain_business_settings → BusinessSettings ===

export interface BrainBusinessSettingsRow {
  store_id: string;
  month: string;
  sales_target: number;
  fixed_costs: Record<string, unknown> | null;
  variable_cost_rate: number | string;
  seat_capacity: Record<string, unknown> | null;
  variable_rates: Record<string, unknown> | null;
}

export function toBusinessSettings(row: BrainBusinessSettingsRow): BusinessSettings {
  return {
    storeId: row.store_id,
    month: row.month,
    salesTarget: row.sales_target,
    fixedCosts: row.fixed_costs,
    variableCostRate: Number(row.variable_cost_rate),
    seatCapacity: row.seat_capacity,
    variableRates: row.variable_rates,
  };
}

/** BusinessSettingsUpsertInput(camelCase) → brain_business_settings UPSERT行(snake_case)。undefinedのキーは含めない(SET対象外)。 */
export function fromBusinessSettingsUpsert(input: {
  storeId: string;
  month: string;
  salesTarget?: number;
  fixedCosts?: Record<string, number | null>;
  variableCostRate?: number;
  variableRates?: Record<string, number | null>;
}): Record<string, unknown> {
  const row: Record<string, unknown> = { store_id: input.storeId, month: input.month };
  if (input.salesTarget !== undefined) row.sales_target = input.salesTarget;
  if (input.fixedCosts !== undefined) row.fixed_costs = input.fixedCosts;
  if (input.variableCostRate !== undefined) row.variable_cost_rate = input.variableCostRate;
  if (input.variableRates !== undefined) row.variable_rates = input.variableRates;
  return row;
}

// === brain_pattern_fire_log(+brain_customers.name) → BriefingEntry ===

export interface BrainFireLogRow {
  id: string;
  customer_id: string;
  visit_id: string | null;
  decision_record: DecisionRecord;
  explanation: string;
  created_at: string;
}

export function toBriefingEntry(row: BrainFireLogRow, customerName: string): BriefingEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName,
    visitId: row.visit_id,
    decisionRecord: row.decision_record,
    explanation: row.explanation,
    createdAt: row.created_at,
  };
}

// === brain_pattern_revisions / brain_revisions → RevisionRecord ===

export interface BrainPatternRevisionRow {
  id: string;
  store_id: string;
  pattern_id: string;
  change_type: RevisionRecord['changeType'];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: RevisionStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface BrainBrandRevisionRow {
  id: string;
  pattern_library_id: string;
  change_type: RevisionRecord['changeType'];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: RevisionStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

// === brain_stores → Store(CSV Import: external_key_hash生成用のanon_salt取得) ===

export interface BrainStoreRow {
  id: string;
  name: string;
  anon_id: string;
  anon_salt: string;
  cluster: string | null;
  price_tier: string | null;
  brain_subscription: boolean;
  learning_mode: boolean;
}

export function toStore(row: BrainStoreRow): Store {
  return {
    id: row.id,
    name: row.name,
    anonId: row.anon_id,
    anonSalt: row.anon_salt,
    cluster: row.cluster ?? '',
    priceTier: row.price_tier ?? '',
    brainSubscription: row.brain_subscription,
    learningMode: row.learning_mode,
  };
}

// === brain_staff ↔ Staff(CSV Import: staffResolver.StaffRow解決の入力) ===

export interface BrainStaffRow {
  id: string;
  store_id: string;
  name: string;
  style: StaffStyle;
  is_active: boolean;
  name_aliases?: string[];
}

export function toStaff(row: BrainStaffRow): Staff {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    style: row.style,
    isActive: row.is_active,
    nameAliases: row.name_aliases ?? [],
  };
}

// === brain_menus → Menu(CSV Import: menuResolver突合の入力) ===

export interface BrainMenuRow {
  id: string;
  store_id: string;
  name: string;
  price: number;
  role: MenuRole;
  target_types: CustomerType[];
}

/** MenuCreateInput(camelCase) → brain_menus INSERT行(snake_case)。 */
export function fromMenuCreateInput(input: {
  storeId: string;
  name: string;
  price: number;
  role: Exclude<MenuRole, 'imported_other'>;
  targetTypes: CustomerType[];
}): Record<string, unknown> {
  return {
    store_id: input.storeId,
    name: input.name,
    price: input.price,
    role: input.role,
    target_types: input.targetTypes,
  };
}

/** MenuUpdateInput(camelCase) → brain_menus UPDATE行(snake_case)。undefinedのキーは含めない(SET対象外)。 */
export function fromMenuUpdateInput(input: {
  name?: string;
  price?: number;
  role?: Exclude<MenuRole, 'imported_other'>;
  targetTypes?: CustomerType[];
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  if (input.role !== undefined) patch.role = input.role;
  if (input.targetTypes !== undefined) patch.target_types = input.targetTypes;
  return patch;
}

export function toMenu(row: BrainMenuRow): Menu {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    price: row.price,
    role: row.role,
    targetTypes: row.target_types,
  };
}

// === brain_subscriptions → Subscription(画面③顧客資産・MD-3のLTV算出に使用) ===

export interface BrainSubscriptionRow {
  id: string;
  store_id: string;
  customer_id: string;
  plan_name: string;
  monthly_price: number;
  started_at: string;
  cancelled_at: string | null;
  cancel_reason: Subscription['cancelReason'];
}

export function toSubscription(row: BrainSubscriptionRow): Subscription {
  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id,
    planName: row.plan_name,
    monthlyPrice: row.monthly_price,
    startedAt: row.started_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
  };
}

// === brain_ops_logs ↔ OpsLog(CSV Import実行結果の監査ログ) ===

export interface BrainOpsLogRow {
  id: string;
  store_id: string;
  kind: string;
  actor_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export function toOpsLog(row: BrainOpsLogRow): OpsLog {
  return {
    id: row.id,
    storeId: row.store_id,
    kind: row.kind,
    actorId: row.actor_id,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

/** OpsLog(idなし) → brain_ops_logs insert行(snake_case)。detailはPIIゼロ契約(呼び出し側責務)。 */
export function toBrainOpsLogInsert(log: Omit<OpsLog, 'id' | 'createdAt'>): Record<string, unknown> {
  return {
    store_id: log.storeId,
    kind: log.kind,
    actor_id: log.actorId,
    detail: log.detail,
  };
}

export function toRevisionRecord(
  row: BrainPatternRevisionRow | BrainBrandRevisionRow,
  scope: RevisionScope
): RevisionRecord {
  return {
    id: row.id,
    scope,
    storeId: 'store_id' in row ? row.store_id : null,
    patternId: 'pattern_id' in row ? row.pattern_id : row.pattern_library_id,
    changeType: row.change_type,
    before: row.before,
    after: row.after,
    evidence: row.evidence,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

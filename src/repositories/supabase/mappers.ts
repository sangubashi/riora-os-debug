// ================================================================
// Pattern Engine Repository - snake_case(DB行) → camelCase(domain型) 変換
//
// DBはsnake_case・TSドメイン型(src/types/riora.types, brain.types)は
// camelCase。変換はこのファイルに集約し、engines/には生のDB行を渡さない。
// ================================================================

import type {
  BriefingEntry,
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
  NoBookingReason,
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
  StaffStyle,
  Visit,
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
  };
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

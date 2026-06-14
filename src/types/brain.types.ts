// ================================================================
// Riora Brain - ブランド横断 (brain_*) テーブル向け型定義
//
// 対応テーブル: brain_events / brain_pattern_library / brain_benchmarks /
// brain_params / brain_revisions (supabase/migrations/20260612000004_brain_tables.sql)
// ================================================================

import type {
  CustomerType,
  StaffStyle,
  ProposalKind,
  MenuRole,
  JsonLogicRule,
  RevisionStatus,
  ScoringWeights,
} from './riora.types';

// === brain_events ===
export type BrainEventType = 'visit' | 'proposal_outcome' | 'churn_confirmed' | 'subscription_change';

export interface BrainEventPayloadMap {
  visit: {
    visitScore: number;
    skinImproved: boolean;
    retailAmountBand: string | null;
  };
  proposal_outcome: {
    stepNo: number;
    wasBriefed: boolean;
    wasExecuted: boolean;
  };
  churn_confirmed: {
    churnReason: string | null;
    cycleRatio: number;
  };
  subscription_change: {
    change: 'started' | 'cancelled';
    cancelReason: 'no_effect' | 'price' | 'distance' | 'other' | null;
    weddingDaysBand: string | null;
  };
}

export type BrainEventPayload = BrainEventPayloadMap[BrainEventType];

export interface BrainEvent<T extends BrainEventType = BrainEventType> {
  id: string;
  storeAnonId: string;
  customerHash: string;
  eventType: T;
  customerType: CustomerType | null;
  staffStyle: StaffStyle | null;
  proposalKind: ProposalKind | null;
  wasAccepted: boolean | null;
  occurredOn: string;
  visitCountAt: number;
  amountBand: string | null;
  payload: BrainEventPayloadMap[T];
}

// === brain_pattern_library ===
export interface BrainPatternLibraryStep {
  label: string;
  proposalKind: ProposalKind;
  menuRole: MenuRole | null;
  fireCondition: JsonLogicRule;
  baseScript: string;
  cooldownVisits: number;
}

export interface BrainPatternLibraryEntry {
  id: string;
  customerType: CustomerType;
  label: string;
  entryCondition: JsonLogicRule;
  steps: BrainPatternLibraryStep[];
  targetCycleDays: number;
  status: 'proposed' | 'approved' | 'rejected';
  version: number;
  sampleStores: number;
}

// === brain_benchmarks ===
export interface Benchmark {
  week: string;
  storeCluster: string;
  metric: string;
  customerType: CustomerType;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sampleStores: number;
  isReference: boolean;
}

// === brain_params ===
export interface BrainParams<T = Record<string, unknown>> {
  key: string;
  cluster: string;
  version: number;
  value: T;
}

// === brain_params シード値 (20260612000008_w8_pattern_engine.sql) ===

/** w4 StaffAffinityのprior。実測affinity_scoreが無い場合のフォールバック。 */
export type StyleAffinityTable = Record<StaffStyle, Record<ProposalKind, number>>;

/** Success Pattern Final v1.0 3-1 lifecycle_status状態機械の遷移閾値。 */
export interface LifecycleThresholds {
  promotion: { liftPt: number; evaluationDays: number; minN: number };
  watchDemotion: { benchmarkPercentile: number; dropPt: number; minN: number };
  watchRecovery: { periods: number; periodDays: number; minN: number };
  demotion: { watchDays: number; minN: number };
  suspension: { acceptRateMin: number; minN: number; rejectRateMax: number; rejectMinN: number };
}

/** brain_params.key別のvalue型。IParamsRepoの戻り値型を一意に解決する。 */
export interface BrainParamsValueMap {
  fire_score_weights: ScoringWeights;
  style_affinity: StyleAffinityTable;
  lifecycle_thresholds: LifecycleThresholds;
}

export type BrainParamKey = keyof BrainParamsValueMap;

// === brain_revisions / brain_pattern_revisions (Lv4Validatorの入力) ===
export type RevisionChangeType =
  | 'timing'
  | 'condition'
  | 'script'
  | 'new_pattern'
  | 'churn_weights'
  | 'staff_adjustment';

export interface RevisionProposal {
  id?: string;
  scope: 'store' | 'brand';
  storeId?: string;
  patternId: string;
  changeType: RevisionChangeType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: RevisionStatus;
}

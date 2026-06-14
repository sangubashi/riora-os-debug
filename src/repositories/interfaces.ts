// ================================================================
// Repository Interfaces
// (Success Pattern Final Architecture v1.0 / Pattern Engine Code
//  Architecture v1.0 §2 / Repository & RPC Architecture v1.0)
//
// Supabase隔離境界: src/engines/** はこのファイルと src/types/** のみ
// import可能。実装(src/repositories/supabase/*)はservices/やDIコンテナ
// からのみimportすること。
//
// I*Repo実装の責務: DBアクセスのみ(ビジネスロジック禁止・SQL禁止・
// Supabase Clientのクエリビルダのみ)。snake_case<->camelCase変換は
// src/repositories/supabase/mappers.tsに集約する。
// ================================================================

import type {
  UUID,
  CustomerType,
  Candidate,
  CellKey,
  CellStats,
  ScoringWeights,
  OutcomeLite,
  Customer,
  Visit,
  ScenarioCandidateRow,
  LineSendQueuePayload,
  LineQueueItem,
  LineQueueStatus,
  DashboardSnapshot,
  BriefingEntry,
  RevisionRecord,
  RevisionScope,
} from '../types/riora.types';
import type { StyleAffinityTable, BrainEvent, BrainEventType } from '../types/brain.types';

export interface ICandidateRepo {
  /**
   * 店内提案(in_store)候補を2層解決済(Candidate[])で返す。
   * brain_success_patterns(store_id=storeId またはNULL=ブランド標準)×is_active=true
   * の各brain_pattern_stepsを1候補にフラット化する。
   * lifecycle_status(candidate/testing/active/watch/demoted/suspended)による
   * 活性判定はPatternMatcherのStage0で行う(本メソッドはis_activeのみで絞り込む)。
   */
  loadActive(storeId: UUID): Promise<Candidate[]>;
}

export interface IStatsRepo {
  /** brain_pattern_step_stats(マテビュー)からセル統計をIN句1クエリで取得する。 */
  loadCells(keys: CellKey[]): Promise<Map<CellKey, CellStats>>;
}

export interface IParamsRepo {
  /** brain_params(key='fire_score_weights', cluster別)の最新versionを返す。 */
  weights(cluster: string): Promise<ScoringWeights>;
  /** brain_params(key='style_affinity', cluster別)の最新versionを返す。 */
  styleAffinity(cluster: string): Promise<StyleAffinityTable>;
}

export interface IOutcomeRepo {
  /** brain_proposal_outcomesから直近n件を新しい順で返す(G-COOL/G-FREQ判定の入力)。 */
  recent(customerId: UUID, n: number): Promise<OutcomeLite[]>;
}

// ================================================================
// Repository & RPC Layer v1.0: Customer / Visit / Scenario / LineQueue /
// BrainEvent
// ================================================================

export interface ICustomerRepo {
  /** brain_customers.idで1件取得する(deleted_at IS NULL)。存在しない場合はnull。 */
  findById(id: UUID): Promise<Customer | null>;
  /** brain_customersをstore_idで一覧取得する(deleted_at IS NULL)。 */
  listByStore(storeId: UUID): Promise<Customer[]>;
}

export interface IVisitRepo {
  /** brain_visitsをcustomer_idでvisit_date降順に直近n件取得する(deleted_at IS NULL)。 */
  recentByCustomer(customerId: UUID, n: number): Promise<Visit[]>;
  /** brain_visitsへ1件追加し、生成された行(id付き)を返す。 */
  create(visit: Omit<Visit, 'id'>): Promise<Visit>;
  /** brain_visitsをcustomer_idで件数取得する(deleted_at IS NULL)。SaveVisitRecordのvisit_count_at算出に使用。 */
  countByCustomer(customerId: UUID): Promise<number>;
}

export interface IScenarioRepo {
  /**
   * brain_scenarios(store_id=storeId またはNULL=ブランド標準)×is_active=true
   * を、brain_line_send_queue(customer_id=customerId, status='sent')から求めた
   * lastSentAtを付与してScenarioCandidateRow[]として返す
   * (ScenarioSelector.selectへそのまま渡せる形)。
   */
  loadActive(storeId: UUID, customerId: UUID): Promise<ScenarioCandidateRow[]>;
}

export interface ILineQueueRepo {
  /** brain_line_send_queueへ1件追加し、生成されたidを返す(approval_status='pending'固定)。 */
  enqueue(payload: LineSendQueuePayload): Promise<UUID>;
  /** brain_line_send_queueをstore_id + status='pending'で一覧取得する(承認待ちキュー)。 */
  listPendingByStore(storeId: UUID): Promise<LineQueueItem[]>;
  /** brain_line_send_queue.statusをidで更新し、更新後の行を返す(ApproveLineSend)。対象が存在しない場合はnull。 */
  updateStatus(id: UUID, status: LineQueueStatus): Promise<LineQueueItem | null>;
}

export interface IBrainEventRepo {
  /** brain_eventsへ1件追加し、生成された行(id付き)を返す(nightly-etlの匿名化イベント書込)。 */
  insert(event: Omit<BrainEvent, 'id'>): Promise<BrainEvent>;
  /** brain_eventsをevent_type + customer_typeでoccurred_on降順に直近n件取得する(monthly-learning集計入力)。 */
  recentByType(eventType: BrainEventType, customerType: CustomerType, n: number): Promise<BrainEvent[]>;
}

// ================================================================
// P0 API Layer v1.0: Dashboard / Briefing / Revision
// ================================================================

export interface IDashboardRepo {
  /** brain_dashboard_dailyをstore_idでsnapshot_date降順に最新1件取得する(GetDashboard)。存在しない場合はnull。 */
  latestByStore(storeId: UUID): Promise<DashboardSnapshot | null>;
}

export interface IBriefingRepo {
  /**
   * brain_pattern_fire_logをcustomer_idでcreated_at降順に最新1件取得し、
   * brain_customers.nameを付与してBriefingEntryとして返す(GetBriefing P0簡易版)。
   * 存在しない場合はnull。
   */
  latestByCustomer(customerId: UUID): Promise<BriefingEntry | null>;
}

export interface IRevisionRepo {
  /**
   * scope='store'はbrain_pattern_revisions、scope='brand'はbrain_revisionsをidで
   * 更新し、status='approved'・decided_by・decided_at=now()を設定して更新後の行を
   * 返す(ApproveRevision)。対象行が存在しないかstatus!='proposed'の場合はnull。
   */
  approve(scope: RevisionScope, id: UUID, decidedBy: UUID): Promise<RevisionRecord | null>;
}

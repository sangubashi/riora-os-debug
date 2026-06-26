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
  Menu,
  OpsLog,
  Staff,
  Store,
  Visit,
  ScenarioCandidateRow,
  LineSendQueuePayload,
  LineQueueItem,
  LineQueueStatus,
  DashboardSnapshot,
  BusinessSettings,
  BriefingEntry,
  RevisionRecord,
  RevisionScope,
  Subscription,
  AIInsight,
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

export interface IStoreRepo {
  /** brain_stores.idで1件取得する(deleted_at IS NULL)。CSV Importのanon_salt(external_key_hash生成)取得に使用。存在しない場合はnull。 */
  findById(id: UUID): Promise<Store | null>;
}

export interface ICustomerRepo {
  /** brain_customers.idで1件取得する(deleted_at IS NULL)。存在しない場合はnull。 */
  findById(id: UUID): Promise<Customer | null>;
  /** brain_customersをstore_idで一覧取得する(deleted_at IS NULL)。CSV ImportのCustomerMatcherが名寄せ候補探索に使う。 */
  listByStore(storeId: UUID): Promise<Customer[]>;
  /** brain_customersをstore_id+external_key_hashで1件取得する(CSV Import照合キー完全一致)。存在しない場合はnull。 */
  findByExternalKeyHash(storeId: UUID, externalKeyHash: string): Promise<Customer | null>;
  /** brain_customersへ1件追加し、生成された行(id付き)を返す(CSV Import新規顧客)。 */
  create(input: {
    storeId: UUID;
    name: string;
    ageGroup: string | null;
    firstVisitDate: string | null;
    prefecture: string | null;
    city: string | null;
    externalKeyHash: string | null;
  }): Promise<Customer>;
  /**
   * 既存顧客のprefecture/city/age_group/first_visit_dateを空欄補完する(COALESCE方向・
   * 既存の手入力値は上書きしない)。CSV Import再取込時の更新に使用。
   */
  patchFromImport(id: UUID, input: {
    ageGroup: string | null;
    firstVisitDate: string | null;
    prefecture: string | null;
    city: string | null;
  }): Promise<Customer>;
  /**
   * CustomerTypeEngineの分類結果をcustomer_type/type_confidenceへ保存する(Pass H)。
   * customerType=nullの場合はNULLのまま保存する(架空のタイプを書き込まない)。
   */
  updateCustomerType(id: UUID, input: { customerType: CustomerType | null; typeConfidence: number }): Promise<Customer>;
}

export interface IVisitRepo {
  /** brain_visitsをcustomer_idでvisit_date降順に直近n件取得する(deleted_at IS NULL)。 */
  recentByCustomer(customerId: UUID, n: number): Promise<Visit[]>;
  /** brain_visitsへ1件追加し、生成された行(id付き)を返す。 */
  create(visit: Omit<Visit, 'id'>): Promise<Visit>;
  /** brain_visitsをcustomer_idで件数取得する(deleted_at IS NULL)。SaveVisitRecordのvisit_count_at算出に使用。 */
  countByCustomer(customerId: UUID): Promise<number>;
  /**
   * brain_visitsをcustomer_id+visit_dateで1件取得する(deleted_at IS NULL)。
   * CSV Importの突合キー(W19: customer_id+visit_dateで既存idx_brain_visits_customer_dateを再利用)。
   * 同日複数件は来店時刻情報がCSVに無いため先頭1件を返す。存在しない場合はnull。
   */
  findByCustomerAndDate(customerId: UUID, visitDate: string): Promise<Visit | null>;
  /**
   * 既存visit(主にsource='staff_input')をCSV内容で突合更新し、source='reconciled'に
   * 切り替える(Brain学習対象化)。更新後の行を返す。
   */
  reconcile(id: UUID, input: {
    staffId: UUID;
    menuId: UUID;
    isNomination: boolean;
    treatmentAmount: number;
    retailAmount: number;
  }): Promise<Visit>;
  /** brain_visitsをstore_id+visit_dateでtreatment_amount+retail_amountの合計を返す(deleted_at IS NULL)。画面①本日売上。 */
  sumSalesByStoreAndDate(storeId: UUID, visitDate: string): Promise<number>;
  /**
   * brain_visitsをstore_idでvisit_date昇順に全件取得する(deleted_at IS NULL)。
   * DashboardAggregatorが月次集計(売上/来店人数/リピート率/指名率)の入力として
   * 1回だけ全件取得し、メモリ上で集計する(行ごとのDB問い合わせはしない)。
   * リピート率は来店間隔を顧客ごとの来店履歴全体から計算するため、対象月だけでなく
   * 全履歴が必要。
   */
  listByStore(storeId: UUID): Promise<Visit[]>;
}

export interface IStaffRepo {
  /** brain_staffをstore_idで一覧取得する(deleted_at IS NULL)。CSV Importのstaffリゾルバが1回だけ全件取得して使う。 */
  listByStore(storeId: UUID): Promise<Staff[]>;
  /**
   * brain_staff.name_aliases(jsonb配列)へ1件追記する(既に含まれていれば何もしない・冪等)。
   * 更新後の行を返す。対象staffIdが存在しない場合はnull。
   */
  addNameAlias(staffId: UUID, alias: string): Promise<Staff | null>;
}

export interface IMenuRepo {
  /** brain_menusをstore_idで一覧取得する(deleted_at IS NULL)。CSV Importのmenuリゾルバが名称突合に使う。 */
  listByStore(storeId: UUID): Promise<Menu[]>;
}

export interface ISubscriptionRepo {
  /**
   * brain_subscriptionsをstore_idで一覧取得する(deleted_at IS NULL)。
   * 画面③顧客資産(MD-3)のLTV算出(累計売上 + 継続中サブスクのMRR×6)に使用。
   * 解約済み(cancelled_at IS NOT NULL)も履歴として含めて返す(MRR算出側でフィルタする)。
   */
  listByStore(storeId: UUID): Promise<Subscription[]>;
}

export interface StaffOccupancyRow {
  staffId: UUID;
  staffName: string;
  /** このスタッフが担当した全履歴の来店件数。 */
  visitCount: number;
  /** このスタッフが担当した全履歴の売上(treatment_amount+retail_amount合計)。 */
  sales: number;
  /** このスタッフが担当した全履歴の指名率(0〜1)。担当来店0件はnull。 */
  nominationRate: number | null;
}

export interface DayOfWeekVisitCount {
  dayOfWeek: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  visitCount: number;
}

export interface IOccupancyRepo {
  /**
   * 画面⑤稼働率分析(MD-5)①スタッフ別稼働状況。brain_visits+brain_staffを集計し、
   * スタッフごとの来店件数/売上/指名率を返す(MD-4スタッフ分析と算出対象が重複することを
   * ユーザーが許容済み)。五十音順や順位付けは行わず、brain_staffの取得順をそのまま返す。
   */
  staffOccupancy(storeId: UUID): Promise<StaffOccupancyRow[]>;
  /**
   * 画面⑤稼働率分析(MD-5)②曜日別来店数。brain_visits.visit_dateから曜日を算出し、
   * 月〜日の7件(来店が無い曜日は0件)を固定順で返す。
   */
  visitsByDayOfWeek(storeId: UUID): Promise<DayOfWeekVisitCount[]>;
}

export interface IOpsLogRepo {
  /** brain_ops_logsへ1件追加し、生成された行(id付き)を返す。detailにPIIを含めないことは呼び出し側の責務。 */
  insert(log: Omit<OpsLog, 'id' | 'createdAt'>): Promise<OpsLog>;
  /** brain_ops_logsをstore_id+kindでcreated_at降順に直近n件取得する(CSV Import履歴画面用)。 */
  recentByStoreAndKind(storeId: UUID, kind: string, n: number): Promise<OpsLog[]>;
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
  /** brain_line_send_queueをcustomer_idでcreated_at降順に直近n件取得する(AI提案画面のLINE履歴参考表示用)。 */
  recentByCustomer(customerId: UUID, n: number): Promise<LineQueueItem[]>;
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

/**
 * DashboardAggregatorがnightly生成するKPIの部分更新用の入力。
 * segment_matrix/vip_customer_ids等(本Aggregatorのスコープ外の列)は含めない
 * (upsertDailyはこの入力にある列だけをSET・他列は既存値/DB既定値のまま)。
 * aiInsightsは省略可能(未指定の場合はai_insights列をSETしない・既存値を保持する)。
 */
export interface DashboardDailyUpsertInput {
  storeId: UUID;
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
}

export interface IDashboardRepo {
  /** brain_dashboard_dailyをstore_idでsnapshot_date降順に最新1件取得する(GetDashboard)。存在しない場合はnull。 */
  latestByStore(storeId: UUID): Promise<DashboardSnapshot | null>;
  /** brain_dashboard_dailyをstore_id+snapshot_date>=fromDateでsnapshot_date昇順に取得する(画面①売上推移)。 */
  listSinceDate(storeId: UUID, fromDate: string): Promise<DashboardSnapshot[]>;
  /**
   * brain_dashboard_dailyへ(store_id, snapshot_date)でUPSERTする(DashboardAggregatorの
   * nightly書込)。DashboardDailyUpsertInputに含む列のみSETし、ai_insights等の他列は
   * 既存行ならそのまま・新規行ならDB既定値が適用される。
   */
  upsertDaily(input: DashboardDailyUpsertInput): Promise<void>;
}

/**
 * brain_business_settingsへの(store_id, month)単位UPSERT入力(MD-1: 固定費・変動費率設定UI)。
 * 指定したフィールドのみSETする(undefinedのフィールドは既存値/DB既定値のまま)。
 * 損益分岐点・利益予測の計算式(fixed_total/(1-rate)等)はDashboardAggregator側に存在し、
 * 本入力はその"入力データ"を保存するのみで計算は行わない。
 */
export interface BusinessSettingsUpsertInput {
  storeId: UUID;
  /** 対象月の1日(例: '2026-06-01')。 */
  month: string;
  salesTarget?: number;
  /** 固定費の内訳jsonb(キー: officer_suzuki/rent/social_insurance_estimate等)。値はnumberまたはnull(未入力)。 */
  fixedCosts?: Record<string, number | null>;
  /** DashboardAggregatorが実際に計算式へ用いる単一の変動費率(0以上1未満)。 */
  variableCostRate?: number;
  /** 変動費率の内訳jsonb(incentive_rate/square_rate等)。記録用(variableCostRateの代わりに計算式へは使われない)。 */
  variableRates?: Record<string, number | null>;
}

export interface IBusinessSettingsRepo {
  /** brain_business_settingsをstore_id+monthで1件取得する(画面①目標進捗/損益分岐)。存在しない場合はnull。 */
  findByStoreAndMonth(storeId: UUID, month: string): Promise<BusinessSettings | null>;
  /** brain_business_settingsへ(store_id, month)でUPSERTする(固定費・変動費率設定UIの保存先)。更新後の行を返す。 */
  upsert(input: BusinessSettingsUpsertInput): Promise<BusinessSettings>;
}

export interface IBriefingRepo {
  /**
   * brain_pattern_fire_logをcustomer_idでcreated_at降順に最新1件取得し、
   * brain_customers.nameを付与してBriefingEntryとして返す(GetBriefing P0簡易版)。
   * 存在しない場合はnull。
   */
  latestByCustomer(customerId: UUID): Promise<BriefingEntry | null>;
  /**
   * brain_pattern_fire_logへ1件追加し、生成された行(id付き)を返す(AI提案結果保存)。
   * decisionRecordはDecisionRecordのスーパーセット(explainTextsを含む)を許容する
   * (jsonb列のため型はRecord<string, unknown>で受ける)。visitIdは未確定の場合null可。
   */
  insert(input: { storeId: UUID; customerId: UUID; visitId: UUID | null; decisionRecord: Record<string, unknown>; explanation: string }): Promise<BriefingEntry>;
}

export interface IRevisionRepo {
  /**
   * scope='store'はbrain_pattern_revisions、scope='brand'はbrain_revisionsをidで
   * 更新し、status='approved'・decided_by・decided_at=now()を設定して更新後の行を
   * 返す(ApproveRevision)。対象行が存在しないかstatus!='proposed'の場合はnull。
   */
  approve(scope: RevisionScope, id: UUID, decidedBy: UUID): Promise<RevisionRecord | null>;
}

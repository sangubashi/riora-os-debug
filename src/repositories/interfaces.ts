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
  MenuRole,
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
   * brain_visitsへ1件追加し、visit_count_atをDB側RPC(public.insert_visit_with_sequence、
   * MD-5B)にpg_advisory_xact_lock配下で原子的に採番させる(MD-5C)。
   * 呼び出し側はvisitCountAtを渡さない(渡せない)。countByCustomer()+create()の
   * 非原子パターン(MD-2〜MD-4で確認した不整合の原因)を新規呼び出し元では使わせないための
   * 追加メソッド。create()/countByCustomer()は非破壊のため残置する。
   */
  createSequenced(visit: Omit<Visit, 'id' | 'visitCountAt'>): Promise<Visit>;
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
   * brain_visits.menu_idをid指定で更新する(Pass L-2: メニュー再解決専用)。
   * source='salonboard_import'の行のみ更新するDBガードをリポジトリ層で実施する。
   * 他フィールド(staff_id/amount等)は変更しない。
   */
  updateMenuId(id: UUID, menuId: UUID): Promise<void>;
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

/**
 * brain_menus新規作成入力(メニューマスタ管理画面専用)。
 * role='imported_other'はCSV突合エンジンのフォールバック専用行のため、
 * 新規作成時の選択肢からは除外する(API層でも二重にガードする)。
 */
export interface MenuCreateInput {
  storeId:     UUID;
  name:        string;
  price:       number;
  role:        Exclude<MenuRole, 'imported_other'>;
  targetTypes: CustomerType[];
}

/** brain_menus部分更新入力(メニューマスタ管理画面専用)。指定したフィールドのみSET。 */
export interface MenuUpdateInput {
  name?:        string;
  price?:       number;
  role?:        Exclude<MenuRole, 'imported_other'>;
  targetTypes?: CustomerType[];
}

export interface IMenuRepo {
  /** brain_menusをstore_idで一覧取得する(deleted_at IS NULL)。CSV Importのmenuリゾルバが名称突合に使う。 */
  listByStore(storeId: UUID): Promise<Menu[]>;
  /** idで1件取得する(deleted_at IS NULL)。メニューマスタ管理画面の編集/削除前チェック用。 */
  findById(id: UUID): Promise<Menu | null>;
  /** 新規メニューを作成する。 */
  create(input: MenuCreateInput): Promise<Menu>;
  /** 指定idのメニューを部分更新する。対象が存在しない(または論理削除済み)場合はnull。 */
  update(id: UUID, input: MenuUpdateInput): Promise<Menu | null>;
  /** 論理削除(deleted_at更新)。物理削除は行わない(brain_visits.menu_idのON DELETE RESTRICTのため)。 */
  softDelete(id: UUID): Promise<void>;
  /** 指定menu_idを参照するbrain_visits件数。削除可否判定(参照中は削除拒否)に使う。 */
  countVisitsByMenuId(id: UUID): Promise<number>;
}

/**
 * reservations(予約)テーブルへの入力(予約CSV Import専用)。
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md §7(RES-2/RES-3確定事項)
 *   - customer_id(legacy)は本パイプラインでは設定しない(常にNULL)。
 *   - staff_idはprofiles.id(brain_staff.user_id経由で解決済みの値)を渡すこと。
 *   - menuはbrain_menusへの解決を行わずtext列へそのまま格納する。
 */
export interface ReservationUpsertInput {
  staffId:         UUID;
  brainCustomerId: UUID | null;
  menu:            string;
  price:           number;
  scheduledAt:     string;
  durationMinutes: number;
  status:          'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  isNewCustomer:   boolean;
  notes:           string | null;
}

export interface ReservationRow {
  id: UUID;
}

export interface IReservationRepo {
  /**
   * 暫定複合キー(staff_id, scheduled_at, brain_customer_id)で既存行を検索する
   * (RES-3確定の暫定UPSERTキー。「予約番号」列が無いための代替。リスケジュール時は
   * 別行として扱われる既知の制約がある)。
   */
  findByNaturalKey(staffId: UUID, scheduledAt: string, brainCustomerId: UUID | null): Promise<ReservationRow | null>;
  /** reservationsへ1件追加し、生成された行(id付き)を返す。 */
  create(input: ReservationUpsertInput): Promise<ReservationRow>;
  /** reservationsを1件更新する(再取込時の冪等更新)。 */
  update(id: UUID, input: ReservationUpsertInput): Promise<void>;
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

export interface HourlyVisitCount {
  /** JST時間帯(0〜23時)。 */
  hour: number;
  visitCount: number;
}

export interface DailyOccupancyPoint {
  /** JST日付(YYYY-MM-DD)。 */
  date: string;
  /** その日の全スタッフ合計の稼働分数(duration_minutes合計)。 */
  occupiedMinutes: number;
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
  /**
   * 画面⑤稼働率分析(MD-5)③時間帯別来店数(RES-5・Tier1)。reservations(予約CSV Importで
   * 投入されたデータ)をJST時間帯別に集計する(status='completed'=実来店のみ対象)。
   * staffOccupancy/visitsByDayOfWeekと同様に全履歴を対象にする(date絞り込みなし)。
   * reservationsにstore_id列が存在しないため、storeIdによる絞り込みは行わない
   * (現状単一店舗運用のため実害なし。将来の複数店舗対応時の既知の制約)。
   */
  hourlyVisits(): Promise<HourlyVisitCount[]>;
  /**
   * 画面⑤稼働率分析(MD-5)④稼働分数推移(RES-5・Tier1)。reservations(status IN
   * ('confirmed','completed')=稼働予定として集計)のduration_minutesを日別合計する。
   * seat_capacity(曜日×時間帯別の席数)は未実装のため「稼働率%」ではなく「稼働分数」までを返す。
   */
  occupancyTrend(fromDate: string, toDate: string): Promise<DailyOccupancyPoint[]>;
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
  /** brain_dashboard_dailyでsnapshot_date<=dateの最新1件を取得する(月指定表示用)。存在しない場合はnull。 */
  latestBeforeOrAt(storeId: UUID, date: string): Promise<DashboardSnapshot | null>;
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
  /**
   * brain_business_settingsをstore_id+month<=指定monthで最新1件取得する(月跨ぎ固定費フォールバック用)。
   * 当月行が存在しない場合に直前の設定を引き継ぐために使用する。存在しない場合はnull。
   */
  findLatestBeforeOrAt(storeId: UUID, month: string): Promise<BusinessSettings | null>;
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

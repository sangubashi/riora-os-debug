/**
 * DashboardAggregator.ts — nightly-dashboard(画面①経営TOP/MD-1)の集計サービス
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md
 *     「集計は全て nightly-dashboard(DashboardAggregator拡張)で生成→画面は読むだけ」
 *   - supabase/migrations/20260620_w19_dashboard_diff.sql のCOMMENT ON COLUMN群
 *     (各列の定義はこのファイルのコメントを正とする)
 *
 * brain_visits(+brain_business_settings)を集計し、brain_dashboard_daily(store_id,
 * snapshot_date)へUPSERTする。計算はすべて決定論的なコード(本ファイル)で行い、
 * LLM/AIによる数値計算は行わない。
 *
 * 対象KPI(本Aggregatorが生成する列。vip_customer_ids/relation_triggers/
 * occupancy/segment_matrix/funnel/staff_matrix/rebooking_rate/dm_to_booking_rate/
 * new_ratio/homecare_rate/repeat_rate_90dは対象外・既存値を保持):
 *   monthly_sales / forecast_sales / breakeven_point / month_profit_est /
 *   visit_count / repeat_30 / repeat_60 / repeat_90 / nomination_rate / ai_insights
 *
 * 「本日売上」はnightly集計の対象外(GET /api/dashboard/topがVisitRepo.
 * sumSalesByStoreAndDate()で当日visitsを直接ライブ集計する設計・v2.0準拠)。
 *
 * ai_insights(「今日の一手」AI Warning)はAIWarningEngine.ts(決定論ルール・LLM不使用)
 * が生成する。**computeDashboardAggregate()(月売上/着地予測/損益分岐/利益予測/
 * 来店人数/リピート率/指名率の既存計算式)はAI Warning追加にあたり一切変更していない**
 * (runDashboardAggregator()がオーケストレーション層で結果を合成するだけ)。
 */
import type {
  IVisitRepo, IBusinessSettingsRepo, IDashboardRepo, ICustomerRepo, IStaffRepo, ISubscriptionRepo,
  IOpsLogRepo, DashboardDailyUpsertInput,
} from '../../repositories/interfaces';
import type { Visit } from '../../types/riora.types';
import { computeAIWarnings } from './AIWarningEngine';

export interface DashboardAggregatorRepos {
  visitRepo: IVisitRepo;
  businessSettingsRepo: IBusinessSettingsRepo;
  dashboardRepo: IDashboardRepo;
  customerRepo: ICustomerRepo;
  staffRepo: IStaffRepo;
  subscriptionRepo: ISubscriptionRepo;
}

/** refreshDashboardAfterImport()専用。DashboardAggregatorReposにopsLogRepoを加えたもの。 */
export interface DashboardRebuildRepos extends DashboardAggregatorRepos {
  opsLogRepo: IOpsLogRepo;
}

export type DashboardAggregate = DashboardDailyUpsertInput;

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

function daysInMonth(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(year, month, 0).getDate();
}

/** fixed_costs(jsonb内訳)の数値リーフを合算する。null値・非数値キーは無視する。
 * 有効な数値が1件もない場合(全nullオブジェクト含む)はnullを返す。未設定(null)もnullを返す。 */
function sumFixedCosts(fixedCosts: Record<string, unknown> | null): number | null {
  if (!fixedCosts) return null;
  let total = 0;
  let hasValue = false;
  for (const value of Object.values(fixedCosts)) {
    if (typeof value === 'number' && Number.isFinite(value)) { total += value; hasValue = true; }
  }
  return hasValue ? total : null;
}

/** fixed_costsに有効な数値フィールドが1件以上存在するか判定する。全nullオブジェクトはfalse。 */
function hasValidFixedCosts(settings: { fixedCosts: Record<string, unknown> | null } | null): boolean {
  if (!settings?.fixedCosts) return false;
  return Object.values(settings.fixedCosts).some(v => typeof v === 'number' && Number.isFinite(v));
}

/**
 * 来店間隔が`withinDays`日以内だった割合を返す(「30/60/90日コホート再来率」の
 * 本実装での定義: 対象月の来店のうち、当該顧客の直前来店からの間隔がwithinDays日
 * 以内だった割合。初回来店(直前来店が無い)は分母から除外する)。
 * 直前来店は対象月より前の来店も含む全履歴から探す(月初直後の来店が前月の来店を
 * 正しく参照できるようにするため)。
 */
function repeatRateWithin(monthVisits: Visit[], visitsByCustomer: Map<string, Visit[]>, withinDays: number): number | null {
  let withPrevious = 0;
  let withinWindow = 0;

  for (const visit of monthVisits) {
    const history = visitsByCustomer.get(visit.customerId) ?? [];
    const idx = history.indexOf(visit);
    if (idx <= 0) continue; // 初回来店(直前来店なし)は対象外

    withPrevious += 1;
    const previous = history[idx - 1];
    const gapDays = (Date.parse(visit.visitDate) - Date.parse(previous.visitDate)) / 86_400_000;
    if (gapDays <= withinDays) withinWindow += 1;
  }

  return withPrevious > 0 ? withinWindow / withPrevious : null;
}

export interface ComputeDashboardAggregateInput {
  storeId: string;
  /** 集計対象日(YYYY-MM-DD)。 */
  snapshotDate: string;
  /** store_idの全visits(deleted_at除外済み)。visit_date昇順を期待する(リピート率の前回来店探索に使用)。 */
  visits: Visit[];
  variableCostRate: number;
  fixedCosts: Record<string, unknown> | null;
}

/** DB/Supabaseに依存しない純粋関数。テストはこの関数を直接呼ぶ。 */
export function computeDashboardAggregate(input: ComputeDashboardAggregateInput): DashboardAggregate {
  const { storeId, snapshotDate, visits, variableCostRate, fixedCosts } = input;
  const monthStart = firstOfMonth(snapshotDate);

  // monthly_sales等は「月初からsnapshot_dateまでのMTD累計」(全KPIで粒度を統一)。
  const monthVisits = visits.filter((v) => v.visitDate >= monthStart && v.visitDate <= snapshotDate);

  const monthlySales = monthVisits.reduce((sum, v) => sum + v.treatmentAmount + v.retailAmount, 0);

  // 着地予測(forecast_sales) = 月初からのランレート(MTD売上 ÷ 経過日数 × 当月日数)。
  const elapsedDays = dayOfMonth(snapshotDate);
  const totalDays = daysInMonth(snapshotDate);
  const forecastSales = monthlySales > 0 ? Math.round((monthlySales / elapsedDays) * totalDays) : 0;

  const fixedCostsTotal = sumFixedCosts(fixedCosts);
  const breakevenPoint = fixedCostsTotal === null
    ? null
    : Math.round(fixedCostsTotal / (1 - variableCostRate));
  // month_profit_est(月次"着地"利益予測・COMMENT ON COLUMN準拠)はforecast_sales基準。
  const monthProfitEst = fixedCostsTotal === null
    ? null
    : Math.round(forecastSales * (1 - variableCostRate) - fixedCostsTotal);

  // 来店人数: 件数(来店イベント数)ではなく人数(ユニーク顧客数)。
  const visitCount = new Set(monthVisits.map((v) => v.customerId)).size;

  const nominationRate = monthVisits.length > 0
    ? monthVisits.filter((v) => v.isNomination).length / monthVisits.length
    : null;

  const visitsByCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = visitsByCustomer.get(v.customerId) ?? [];
    list.push(v);
    visitsByCustomer.set(v.customerId, list);
  }

  return {
    storeId,
    snapshotDate,
    monthlySales,
    forecastSales,
    breakevenPoint,
    monthProfitEst,
    visitCount,
    repeat30: repeatRateWithin(monthVisits, visitsByCustomer, 30),
    repeat60: repeatRateWithin(monthVisits, visitsByCustomer, 60),
    repeat90: repeatRateWithin(monthVisits, visitsByCustomer, 90),
    nominationRate,
  };
}

export interface RunDashboardAggregatorInput {
  storeId: string;
  snapshotDate: string;
}

function previousMonthFirstDay(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const prev = new Date(Date.UTC(year, month - 2, 1)); // month is 1-based; month-2 = 前月(0-based)
  return prev.toISOString().slice(0, 10);
}

/** repos経由でvisits/business_settings/customers/staff/subscriptionsを取得→集計→brain_dashboard_dailyへUPSERTする(nightly実行の本体)。 */
export async function runDashboardAggregator(
  input: RunDashboardAggregatorInput,
  repos: DashboardAggregatorRepos
): Promise<DashboardAggregate> {
  const monthStart = firstOfMonth(input.snapshotDate);

  const [visits, settingsForMonth, customers, staff, subscriptions, recentSnapshots] = await Promise.all([
    repos.visitRepo.listByStore(input.storeId),
    repos.businessSettingsRepo.findByStoreAndMonth(input.storeId, monthStart),
    repos.customerRepo.listByStore(input.storeId),
    repos.staffRepo.listByStore(input.storeId),
    repos.subscriptionRepo.listByStore(input.storeId),
    repos.dashboardRepo.listSinceDate(input.storeId, previousMonthFirstDay(input.snapshotDate)),
  ]);

  // 当月行が未作成の場合、または fixed_costs が全 null(未入力)の場合は
  // 直前月の設定を引き継ぐ(月跨ぎ固定費永続化)。
  const settings = hasValidFixedCosts(settingsForMonth)
    ? settingsForMonth
    : (await repos.businessSettingsRepo.findLatestBeforeOrAt(
        input.storeId, previousMonthFirstDay(input.snapshotDate)
      )) ?? settingsForMonth;

  // computeDashboardAggregate()(既存の計算式)はAI Warning追加にあたり一切変更していない。
  const result = computeDashboardAggregate({
    storeId: input.storeId,
    snapshotDate: input.snapshotDate,
    visits,
    variableCostRate: settings?.variableCostRate ?? 0,
    fixedCosts: settings?.fixedCosts ?? null,
  });

  // 前月の最終スナップショット(リピート率/指名率の低下検知の比較基準・brain_dashboard_dailyの
  // 既存データを読むだけで新たな計算式は追加しない)。
  const previousMonthFinal = recentSnapshots
    .filter((s) => s.snapshotDate < monthStart)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null;

  const aiInsights = computeAIWarnings({
    asOfDate: input.snapshotDate,
    customers,
    visits,
    staff,
    subscriptions,
    monthlyVisitCount: result.visitCount,
    currentRepeat30: result.repeat30,
    previousRepeat30: previousMonthFinal?.repeat30 ?? null,
    currentNominationRate: result.nominationRate,
    previousNominationRate: previousMonthFinal?.nominationRate ?? null,
  });

  const finalResult: DashboardAggregate = { ...result, aiInsights };

  await repos.dashboardRepo.upsertDaily(finalResult);
  return finalResult;
}

/**
 * CSV取込(売上明細/予約)完了直後にDashboardAggregatorを自動実行し、brain_dashboard_dailyを
 * 即時最新化する(PHASE MD-4)。実行前後のmonthlySales/visitCountをbrain_ops_logsへ
 * kind='dashboard_rebuild'で記録する。
 *
 * 失敗時の扱い(要件③): 本関数が例外をthrowした場合、CSV取込自体を失敗扱いにしないのは
 * 呼び出し側(各CSV取込APIルート)の責務。本関数はここではcatchせずそのまま投げる
 * (呼び出し側でtry/catchしWarningログのみ出力する設計のため)。
 */
export async function refreshDashboardAfterImport(
  repos: DashboardRebuildRepos,
  storeId: string
): Promise<DashboardAggregate> {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const before = await repos.dashboardRepo.latestByStore(storeId);

  const result = await runDashboardAggregator({ storeId, snapshotDate }, repos);

  await repos.opsLogRepo.insert({
    storeId,
    kind: 'dashboard_rebuild',
    actorId: null,
    detail: {
      snapshotDate,
      beforeMonthlySales: before?.monthlySales ?? null,
      afterMonthlySales: result.monthlySales,
      beforeVisitCount: before?.visitCount ?? null,
      afterVisitCount: result.visitCount,
    },
  });

  return result;
}

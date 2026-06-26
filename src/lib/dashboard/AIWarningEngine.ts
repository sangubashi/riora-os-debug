/**
 * AIWarningEngine.ts — 画面①経営TOP「今日の一手(AI Warning)」生成エンジン
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面①
 *     「今日の一手(AI Warning) | 決定論ルール・LLM不使用。離脱圏/サブスク最適日/
 *      指名偏り等を一行の行動指示で。気づき・グラフは置かない」
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md
 *
 * **LLM/AIモデルは一切使用しない**(決定論ルールのみ)。**モックデータ・固定文言は
 * 使用しない**(該当する実データが無い場合は当該ルールがnullを返し、その日は警告を
 * 生成しない=何も出さないことが正しい挙動)。
 *
 * brain_customers/brain_visits/brain_staff/brain_subscriptionsをその場で集計する
 * (ChurnRiskEngine/CustomerAssetEngineと同じくライブ集計・決定論ルール)。
 * 「失客予兆」はChurnRiskEngine(MD-2)をそのまま再利用し、ロジックを分岐させない。
 * 「VIP来店停滞」はCustomerAssetEngine(MD-3)のLTV算出をそのまま再利用する。
 * 既存のDashboardAggregator.computeDashboardAggregate()(月売上/着地予測/損益分岐/
 * 利益予測/来店人数/リピート率/指名率の計算式)は本ファイルから一切変更しない
 * (呼び出し側でこのファイルの出力を追加するだけ)。
 */
import type { Customer, Visit, Staff, Subscription, AIInsight } from '../../types/riora.types';
import { computeChurnRisk } from '../churn/ChurnRiskEngine';
import { computeCustomerAssets } from '../customerAssets/CustomerAssetEngine';

export type { AIInsight, AIInsightSeverity, AIInsightActionType } from '../../types/riora.types';

/** 来店周期の超過率(daysSinceLastVisit ÷ avgIntervalDays)。来店2回未満・平均間隔0以下は対象外(ChurnRiskEngineと同じガード)。 */
interface VisitCycleStatus {
  lastVisitDate: string;
  avgIntervalDays: number;
  daysSinceLastVisit: number;
  cycleOverRate: number;
}

function computeVisitCycles(visits: Visit[], asOfDate: string): Map<string, VisitCycleStatus> {
  const byCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = byCustomer.get(v.customerId) ?? [];
    list.push(v);
    byCustomer.set(v.customerId, list);
  }

  const result = new Map<string, VisitCycleStatus>();
  for (const [customerId, list] of Array.from(byCustomer.entries())) {
    const sorted = list.slice().sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    if (sorted.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((Date.parse(sorted[i].visitDate) - Date.parse(sorted[i - 1].visitDate)) / 86_400_000);
    }
    const avgIntervalDays = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    if (avgIntervalDays <= 0) continue;

    const lastVisitDate = sorted[sorted.length - 1].visitDate;
    const daysSinceLastVisit = (Date.parse(asOfDate) - Date.parse(lastVisitDate)) / 86_400_000;
    result.set(customerId, { lastVisitDate, avgIntervalDays, daysSinceLastVisit, cycleOverRate: daysSinceLastVisit / avgIntervalDays });
  }
  return result;
}

// ── 1. 失客予兆(ChurnRiskEngineをそのまま再利用・危険度0.25以上=cycleOverRate1.5倍以上) ──

function ruleChurnRisk(customers: Customer[], visits: Visit[], staff: Staff[], asOfDate: string): AIInsight | null {
  const results = computeChurnRisk({ asOfDate, customers, visits, staff });
  if (results.length === 0) return null;

  const top = results[0];
  return {
    title: '失客予兆',
    message: `${top.customerName}様など${results.length}名が来店周期を大きく超過しています(危険度${Math.round(top.churnRiskScore * 100)}%)。${top.assignedStaffName ?? '担当スタッフ'}から状況確認のご連絡をお願いします。`,
    severity: 'critical',
    targetCount: results.length,
    actionType: 'contact_customer',
  };
}

// ── 2. VIP来店停滞(CustomerAssetEngineのLTV算出を再利用・上位20%が対象) ──

function ruleVipStagnation(
  customers: Customer[], visits: Visit[], subscriptions: Subscription[], cycles: Map<string, VisitCycleStatus>
): AIInsight | null {
  const assets = computeCustomerAssets({ customers, visits, subscriptions }).filter((a) => a.visitCount > 0);
  if (assets.length === 0) return null;

  const vipCount = Math.max(1, Math.ceil(assets.length * 0.2));
  const vipIds = new Set(assets.slice(0, vipCount).map((a) => a.customerId));
  const nameById = new Map(customers.map((c) => [c.id, c.name]));

  const stagnant = Array.from(cycles.entries())
    .filter(([id, c]) => vipIds.has(id) && c.cycleOverRate >= 1.0)
    .sort((a, b) => b[1].cycleOverRate - a[1].cycleOverRate);
  if (stagnant.length === 0) return null;

  return {
    title: 'VIP来店停滞',
    message: `VIP顧客(LTV上位20%)の${nameById.get(stagnant[0][0]) ?? '対象顧客'}様など${stagnant.length}名が来店周期を超えています。直接のご連絡を推奨します。`,
    severity: 'critical',
    targetCount: stagnant.length,
    actionType: 'contact_customer',
  };
}

// ── 3. DM反応率低下(実データソース無し・常にnull) ──

/**
 * brain_line_send_queueにはstatus(pending/approved/sent/rejected)しかなく、送信後の
 * 顧客反応(開封/予約への転換)を記録する列が存在しない。dashboard_daily.dm_to_booking_rate
 * 列も現状nightlyで生成されていない(MD-1調査レポートで既知)。実データが無い指標を
 * モックで埋めることは禁止のため、本ルールは恒久的にnullを返す(将来DM反応の実データが
 * 整備された時点で実装する)。
 */
function ruleDmResponseRateDecline(): AIInsight | null {
  return null;
}

// ── 4. リピート率低下 / 5. 指名率低下(前月の最終スナップショットとの比較) ──

function ruleRateDecline(opts: {
  title: string; current: number | null; previous: number | null; monthlyVisitCount: number;
  formatLabel: string;
}): AIInsight | null {
  const { title, current, previous, monthlyVisitCount, formatLabel } = opts;
  if (current === null || previous === null || previous <= 0) return null;

  const declineRatio = (previous - current) / previous;
  if (declineRatio < 0.1) return null; // 10%未満の変動はノイズとして無視(決定論的な閾値)

  return {
    title,
    message: `今月の${formatLabel}が前月比${Math.round(declineRatio * 100)}%低下しています(${Math.round(previous * 100)}%→${Math.round(current * 100)}%)。接客内容・運用の見直しをスタッフと確認してください。`,
    severity: 'warning',
    targetCount: monthlyVisitCount,
    actionType: 'review_staff',
  };
}

// ── 6. 来店周期超過(早期段階・1.0〜1.5倍。1.5倍以上は失客予兆として別途扱う) ──

function ruleVisitCycleOverdue(cycles: Map<string, VisitCycleStatus>, customers: Customer[]): AIInsight | null {
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const targets = Array.from(cycles.entries())
    .filter(([, c]) => c.cycleOverRate >= 1.0 && c.cycleOverRate < 1.5)
    .sort((a, b) => b[1].cycleOverRate - a[1].cycleOverRate);
  if (targets.length === 0) return null;

  return {
    title: '来店周期超過',
    message: `${nameById.get(targets[0][0]) ?? '対象顧客'}様など${targets.length}名が通常の来店周期を超えています。早めのLINE案内で離脱を防ぎましょう。`,
    severity: 'warning',
    targetCount: targets.length,
    actionType: 'send_line',
  };
}

// ── 7. 高単価顧客離脱予兆(客単価上位20%・来店2回以上で安定した平均が取れる顧客が対象) ──

function ruleHighTicketChurnRisk(customers: Customer[], visits: Visit[], cycles: Map<string, VisitCycleStatus>): AIInsight | null {
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const byCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = byCustomer.get(v.customerId) ?? [];
    list.push(v);
    byCustomer.set(v.customerId, list);
  }

  const avgTicket: { customerId: string; avg: number }[] = [];
  for (const [customerId, list] of Array.from(byCustomer.entries())) {
    if (list.length < 2) continue;
    avgTicket.push({ customerId, avg: list.reduce((sum, v) => sum + v.treatmentAmount, 0) / list.length });
  }
  if (avgTicket.length === 0) return null;

  avgTicket.sort((a, b) => b.avg - a.avg);
  const highTicketIds = new Set(avgTicket.slice(0, Math.max(1, Math.ceil(avgTicket.length * 0.2))).map((a) => a.customerId));

  const atRisk = Array.from(cycles.entries())
    .filter(([id, c]) => highTicketIds.has(id) && c.cycleOverRate >= 1.0)
    .sort((a, b) => b[1].cycleOverRate - a[1].cycleOverRate);
  if (atRisk.length === 0) return null;

  return {
    title: '高単価顧客離脱予兆',
    message: `客単価上位20%の${nameById.get(atRisk[0][0]) ?? '対象顧客'}様など${atRisk.length}名に来店間隔の乱れが見られます。優先的にフォローしてください。`,
    severity: 'critical',
    targetCount: atRisk.length,
    actionType: 'contact_customer',
  };
}

// ── 8. サブスク更新接近(継続中サブスクの今月/来月の請求日(started_atの日)が7日以内) ──

function ruleSubscriptionRenewalApproaching(
  subscriptions: Subscription[], customers: Customer[], asOfDate: string, withinDays = 7
): AIInsight | null {
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const today = new Date(`${asOfDate}T00:00:00Z`);

  const approaching: { customerId: string; daysUntil: number }[] = [];
  for (const s of subscriptions) {
    if (s.cancelledAt !== null) continue;
    const billingDay = new Date(`${s.startedAt}T00:00:00Z`).getUTCDate();

    let next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), billingDay));
    if (next.getTime() < today.getTime()) {
      next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, billingDay));
    }
    const daysUntil = Math.round((next.getTime() - today.getTime()) / 86_400_000);
    if (daysUntil <= withinDays) approaching.push({ customerId: s.customerId, daysUntil });
  }
  if (approaching.length === 0) return null;

  approaching.sort((a, b) => a.daysUntil - b.daysUntil);
  const top = approaching[0];
  return {
    title: 'サブスク更新接近',
    message: `${nameById.get(top.customerId) ?? '対象顧客'}様など${approaching.length}名のサブスク更新が${Math.max(top.daysUntil, 0)}日後に迫っています。継続提案・アップセルの準備をしましょう。`,
    severity: 'info',
    targetCount: approaching.length,
    actionType: 'upsell_campaign',
  };
}

// ── エンジン本体 ──

export interface ComputeAIWarningsInput {
  /** 集計基準日(YYYY-MM-DD)。通常はsnapshotDate。 */
  asOfDate: string;
  customers: Customer[];
  visits: Visit[];
  staff: Staff[];
  subscriptions: Subscription[];
  /** 当月(MTD)の来店人数。店舗全体指標(リピート率/指名率低下)のtargetCountに使用する。 */
  monthlyVisitCount: number;
  /** DashboardAggregator.computeDashboardAggregate()が同じ実行で算出した今月のrepeat30(計算式は変更しない)。 */
  currentRepeat30: number | null;
  /** 前月の最終スナップショットのrepeat30(brain_dashboard_dailyの既存データを読むだけ)。無ければnull。 */
  previousRepeat30: number | null;
  currentNominationRate: number | null;
  previousNominationRate: number | null;
}

/**
 * DB/Supabaseに依存しない純粋関数。優先順位(失客予兆→VIP来店停滞→DM反応率低下→
 * リピート率低下→指名率低下→来店周期超過→高単価顧客離脱予兆→サブスク更新接近)で
 * 各ルールを評価し、実データで条件が成立したものだけを配列で返す(該当無しは要素を作らない)。
 */
export function computeAIWarnings(input: ComputeAIWarningsInput): AIInsight[] {
  const {
    asOfDate, customers, visits, staff, subscriptions, monthlyVisitCount,
    currentRepeat30, previousRepeat30, currentNominationRate, previousNominationRate,
  } = input;

  const cycles = computeVisitCycles(visits, asOfDate);

  const candidates: (AIInsight | null)[] = [
    ruleChurnRisk(customers, visits, staff, asOfDate),
    ruleVipStagnation(customers, visits, subscriptions, cycles),
    ruleDmResponseRateDecline(),
    ruleRateDecline({ title: 'リピート率低下', current: currentRepeat30, previous: previousRepeat30, monthlyVisitCount, formatLabel: 'リピート率(30日)' }),
    ruleRateDecline({ title: '指名率低下', current: currentNominationRate, previous: previousNominationRate, monthlyVisitCount, formatLabel: '指名率' }),
    ruleVisitCycleOverdue(cycles, customers),
    ruleHighTicketChurnRisk(customers, visits, cycles),
    ruleSubscriptionRenewalApproaching(subscriptions, customers, asOfDate),
  ];

  return candidates.filter((insight): insight is AIInsight => insight !== null);
}

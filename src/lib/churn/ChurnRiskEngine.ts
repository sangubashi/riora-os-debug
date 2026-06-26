/**
 * ChurnRiskEngine.ts — 画面②離脱予兆センター(MD-2)の集計サービス
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面②
 *     (「分析」でなく「予兆」。失客危険顧客一覧+推奨アクションの導線)
 *   - ユーザー指示(2026-06-23): 表示は危険顧客一覧/最終来店日/来店間隔/
 *     失客リスクスコア/担当スタッフ/「担当スタッフへ指示」アクションのみ。
 *     管理者は閲覧と指示のみ(LINE送信・予約操作は禁止)。
 *
 * brain_customers/brain_visits/brain_staffを集計し、危険顧客一覧をその場で算出する
 * (DashboardAggregatorのようなnightly事前計算はせず、リクエスト時に算出するライブ集計)。
 * brain_customers.churn_score(DB列)は現状どの工程からも更新されていない(常に既定値0)
 * ため使用しない。来店履行履歴から決定論的に算出する(LLM/AI不使用)。
 */
import type { Customer, Visit, Staff } from '../../types/riora.types';

/**
 * 危険判定の閾値。cycleOverRate(来店間隔超過率) = 最終来店からの経過日数 ÷ 平均来店間隔。
 * 1.5(平均間隔の1.5倍を超えて来店が無い)を「危険」の下限とする(本実装で新規に定義した
 * 決定論ルール。アーキ文書に厳密な数式定義が無いため、ここで方針を確定する)。
 */
const CHURN_RISK_THRESHOLD = 0.25; // (cycleOverRate - 1) / 2 が この値以上 ⇔ cycleOverRate >= 1.5

export interface ChurnRiskCustomer {
  customerId: string;
  customerName: string;
  lastVisitDate: string;
  /** 最終来店からの経過日数(asOfDate基準)。 */
  daysSinceLastVisit: number;
  /** この顧客の平均来店間隔(日数・全履歴から算出)。 */
  avgIntervalDays: number;
  /** 失客リスクスコア(0〜1)。cycleOverRateから算出。 */
  churnRiskScore: number;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
}

export interface ComputeChurnRiskInput {
  /** 集計基準日(YYYY-MM-DD)。通常は本日。 */
  asOfDate: string;
  customers: Customer[];
  visits: Visit[];
  staff: Staff[];
}

/** DB/Supabaseに依存しない純粋関数。churnRiskScore降順でソートして返す。 */
export function computeChurnRisk(input: ComputeChurnRiskInput): ChurnRiskCustomer[] {
  const { asOfDate, customers, visits, staff } = input;

  const staffNameById = new Map(staff.map((s) => [s.id, s.name]));
  const visitsByCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = visitsByCustomer.get(v.customerId) ?? [];
    list.push(v);
    visitsByCustomer.set(v.customerId, list);
  }

  const results: ChurnRiskCustomer[] = [];

  for (const customer of customers) {
    const customerVisits = (visitsByCustomer.get(customer.id) ?? [])
      .slice()
      .sort((a, b) => a.visitDate.localeCompare(b.visitDate));

    // 来店が2回未満の顧客は平均来店間隔を算出できない(新規客であり「危険」ではなく
    // 「未確立」のフェーズのため対象外。phase5/customerRiskEngine.tsの'new'フェーズと同じ考え方)。
    if (customerVisits.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < customerVisits.length; i++) {
      const gap = (Date.parse(customerVisits[i].visitDate) - Date.parse(customerVisits[i - 1].visitDate)) / 86_400_000;
      gaps.push(gap);
    }
    const avgIntervalDays = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    if (avgIntervalDays <= 0) continue; // 同日来店等の異常データガード

    const lastVisitDate = customerVisits[customerVisits.length - 1].visitDate;
    const daysSinceLastVisit = (Date.parse(asOfDate) - Date.parse(lastVisitDate)) / 86_400_000;

    const cycleOverRate = daysSinceLastVisit / avgIntervalDays;
    const churnRiskScore = Math.min(1, Math.max(0, (cycleOverRate - 1) / 2));

    if (churnRiskScore < CHURN_RISK_THRESHOLD) continue;

    results.push({
      customerId: customer.id,
      customerName: customer.name,
      lastVisitDate,
      daysSinceLastVisit: Math.round(daysSinceLastVisit),
      avgIntervalDays: Math.round(avgIntervalDays),
      churnRiskScore,
      assignedStaffId: customer.assignedStaffId,
      assignedStaffName: customer.assignedStaffId ? staffNameById.get(customer.assignedStaffId) ?? null : null,
    });
  }

  return results.sort((a, b) => b.churnRiskScore - a.churnRiskScore);
}

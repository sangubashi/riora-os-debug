/**
 * CustomerAssetEngine.ts — 画面③顧客管理(MD-3)の集計サービス
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面③
 *     「LTV(累計売上+MRR×6)」
 *   - ユーザー指示(2026-06-23): 表示は顧客一覧/来店回数/最終来店日/LTV/累計売上/
 *     指名状況/来店間隔のみ。管理者は閲覧のみ(顧客編集・削除は禁止)。
 *
 * brain_customers/brain_visits/brain_subscriptionsをその場で集計する
 * (ChurnRiskEngineと同じくライブ集計・決定論ルール・LLM/AI不使用)。
 */
import type { Customer, Visit, Subscription } from '../../types/riora.types';

export interface CustomerAssetRow {
  customerId: string;
  customerName: string;
  visitCount: number;
  lastVisitDate: string | null;
  /** 累計売上(全履歴のtreatment_amount+retail_amount合計)。 */
  totalSales: number;
  /** LTV = 累計売上 + 継続中サブスクのMRR×6(v2.0「LTV(累計売上+MRR×6)」準拠)。 */
  ltv: number;
  /** 指名状況(全来店のうちis_nomination=trueの割合・0〜1)。来店0件はnull。 */
  nominationRate: number | null;
  /** 平均来店間隔(日数)。来店2回未満は算出不能のためnull。 */
  avgIntervalDays: number | null;
}

export interface ComputeCustomerAssetsInput {
  customers: Customer[];
  visits: Visit[];
  subscriptions: Subscription[];
}

/** DB/Supabaseに依存しない純粋関数。LTV降順(資産価値が高い顧客順)で返す。 */
export function computeCustomerAssets(input: ComputeCustomerAssetsInput): CustomerAssetRow[] {
  const { customers, visits, subscriptions } = input;

  const visitsByCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = visitsByCustomer.get(v.customerId) ?? [];
    list.push(v);
    visitsByCustomer.set(v.customerId, list);
  }

  // 継続中(未解約)サブスクのみMRRに計上する。同一顧客に複数件ある場合は合算する。
  const activeMonthlyPriceByCustomer = new Map<string, number>();
  for (const s of subscriptions) {
    if (s.cancelledAt !== null) continue;
    activeMonthlyPriceByCustomer.set(
      s.customerId,
      (activeMonthlyPriceByCustomer.get(s.customerId) ?? 0) + s.monthlyPrice
    );
  }

  const rows: CustomerAssetRow[] = customers.map((customer) => {
    const customerVisits = (visitsByCustomer.get(customer.id) ?? [])
      .slice()
      .sort((a, b) => a.visitDate.localeCompare(b.visitDate));

    const visitCount = customerVisits.length;
    const lastVisitDate = visitCount > 0 ? customerVisits[visitCount - 1].visitDate : null;
    const totalSales = customerVisits.reduce((sum, v) => sum + v.treatmentAmount + v.retailAmount, 0);
    const nominationRate = visitCount > 0
      ? customerVisits.filter((v) => v.isNomination).length / visitCount
      : null;

    let avgIntervalDays: number | null = null;
    if (visitCount >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < customerVisits.length; i++) {
        gaps.push((Date.parse(customerVisits[i].visitDate) - Date.parse(customerVisits[i - 1].visitDate)) / 86_400_000);
      }
      avgIntervalDays = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length);
    }

    const mrr = activeMonthlyPriceByCustomer.get(customer.id) ?? 0;
    const ltv = totalSales + mrr * 6;

    return {
      customerId: customer.id,
      customerName: customer.name,
      visitCount,
      lastVisitDate,
      totalSales,
      ltv,
      nominationRate,
      avgIntervalDays,
    };
  });

  return rows.sort((a, b) => b.ltv - a.ltv);
}

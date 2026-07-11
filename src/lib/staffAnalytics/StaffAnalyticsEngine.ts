/**
 * StaffAnalyticsEngine.ts — 画面④スタッフ分析(MD-4)の集計サービス
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面④
 *     「3名カード(五十音順・順位/合計/平均比較なし)」「売上単体表示を型で禁止」
 *   - ユーザー指示(2026-06-23): 表示は売上/指名率/リピート率/LTV/成長率の5項目のみ。
 *     ランキング禁止・順位表示禁止・売上単体比較禁止・五十音順表示。
 *
 * brain_staff/brain_visits/brain_subscriptionsをその場で集計する
 * (DashboardAggregator/ChurnRiskEngineと同じくライブ集計・決定論ルール・LLM/AI不使用)。
 *
 * 五十音順についての制約: brain_staffにはふりがな(yomi/kana)列が存在しない
 * (旧customersスキーマのname_kanaに相当する列がBrain側に無い)。本実装は
 * Intl.Collator('ja')による氏名(漢字)の文字列比較で近似する。正確な五十音順には
 * ふりがな列の追加(別migration)が必要(残課題として明記)。
 */
import type { Staff, Visit, Subscription } from '../../types/riora.types';

export interface StaffAnalyticsRow {
  staffId: string;
  staffName: string;
  /** 当月(月初〜asOfDate)の売上(このスタッフが担当した来店のtreatment+retail合計)。 */
  monthlySales: number;
  /** 当月(月初〜asOfDate)にこのスタッフが担当した来店のユニーク顧客数(件数ではなく人数。経営TOPの来店人数と同じ定義。SA-2)。 */
  visitCount: number;
  /** 客単価 = monthlySales ÷ visitCount。visitCount=0の場合はnull(SA-2)。 */
  avgSpend: number | null;
  /** 全履歴のうちこのスタッフが担当した来店の指名率。担当来店0件はnull。 */
  nominationRate: number | null;
  /** 全履歴のうちこのスタッフが担当した来店のリピート率(visit_count_at>1の割合)。担当来店0件はnull。 */
  repeatRate: number | null;
  /** このスタッフが担当した(来店履行歴を持つ)顧客のLTV平均値(MD-3と同じ算出式)。担当顧客0件はnull。 */
  ltv: number | null;
  /** 前月比成長率((当月MTD売上−前月売上)÷前月売上)。前月売上0または前月データ無しはnull。 */
  growthRate: number | null;
}

export interface ComputeStaffAnalyticsInput {
  /** 集計基準日(YYYY-MM-DD)。通常は本日。 */
  asOfDate: string;
  staff: Staff[];
  visits: Visit[];
  subscriptions: Subscription[];
}

function monthRange(date: string): { start: string; end: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = `${date.slice(0, 7)}-01`;
  const end = new Date(year, month, 0).toISOString().slice(0, 10);
  return { start, end };
}

function previousMonthRange(date: string): { start: string; end: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  // monthは1-12。Dateのmonthは0-11なので、前月1日は new Date(year, month-2, 1)。
  const prevMonthDate = new Date(year, month - 2, 1);
  const prevYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth() + 1;
  const start = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  const end = new Date(prevYear, prevMonth, 0).toISOString().slice(0, 10);
  return { start, end };
}

function sumSales(visits: Visit[]): number {
  return visits.reduce((sum, v) => sum + v.treatmentAmount + v.retailAmount, 0);
}

/** DB/Supabaseに依存しない純粋関数。五十音順(近似)で返す。ランキング・順位は一切持たない。 */
export function computeStaffAnalytics(input: ComputeStaffAnalyticsInput): StaffAnalyticsRow[] {
  const { asOfDate, staff, visits, subscriptions } = input;

  const { start: curStart } = monthRange(asOfDate);
  const { start: prevStart, end: prevEnd } = previousMonthRange(asOfDate);

  // 継続中(未解約)サブスクのMRR合計(顧客単位)。MD-3のCustomerAssetEngineと同じ方針。
  const activeMonthlyPriceByCustomer = new Map<string, number>();
  for (const s of subscriptions) {
    if (s.cancelledAt !== null) continue;
    activeMonthlyPriceByCustomer.set(
      s.customerId,
      (activeMonthlyPriceByCustomer.get(s.customerId) ?? 0) + s.monthlyPrice
    );
  }

  // 顧客ごとの全履歴(LTV算出に使う・スタッフを問わず顧客の全来店)。
  const allVisitsByCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = allVisitsByCustomer.get(v.customerId) ?? [];
    list.push(v);
    allVisitsByCustomer.set(v.customerId, list);
  }
  function ltvOfCustomer(customerId: string): number {
    const customerVisits = allVisitsByCustomer.get(customerId) ?? [];
    const totalSales = sumSales(customerVisits);
    const mrr = activeMonthlyPriceByCustomer.get(customerId) ?? 0;
    return totalSales + mrr * 6;
  }

  const rows: StaffAnalyticsRow[] = staff.map((s) => {
    const handledVisits = visits.filter((v) => v.staffId === s.id);

    const monthVisits = handledVisits.filter((v) => v.visitDate >= curStart && v.visitDate <= asOfDate);
    const visitCount = new Set(monthVisits.map((v) => v.customerId)).size;

    const monthlySales = sumSales(monthVisits);
    const avgSpend = visitCount > 0 ? Math.round(monthlySales / visitCount) : null;
    const previousMonthSales = sumSales(handledVisits.filter((v) => v.visitDate >= prevStart && v.visitDate <= prevEnd));
    // 当月の来店が1件も無い場合は「前月比−100%(業績急落)」ではなく「比較データなし」を
    // 意味するため、あえてnullを返す(PHASE MD-2要件4: 当月未蓄積と実悪化の混同防止)。
    const growthRate = previousMonthSales > 0 && monthVisits.length > 0
      ? (monthlySales - previousMonthSales) / previousMonthSales
      : null;

    const nominationRate = handledVisits.length > 0
      ? handledVisits.filter((v) => v.isNomination).length / handledVisits.length
      : null;
    const repeatRate = handledVisits.length > 0
      ? handledVisits.filter((v) => v.visitCountAt > 1).length / handledVisits.length
      : null;

    const customerIds = new Set(handledVisits.map((v) => v.customerId));
    const ltv = customerIds.size > 0
      ? Array.from(customerIds).reduce((sum, cid) => sum + ltvOfCustomer(cid), 0) / customerIds.size
      : null;

    return {
      staffId: s.id,
      staffName: s.name,
      monthlySales,
      visitCount,
      avgSpend,
      nominationRate,
      repeatRate,
      ltv,
      growthRate,
    };
  });

  const collator = new Intl.Collator('ja');
  return rows.sort((a, b) => collator.compare(a.staffName, b.staffName));
}

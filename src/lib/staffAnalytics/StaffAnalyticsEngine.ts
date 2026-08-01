/**
 * StaffAnalyticsEngine.ts — 画面④スタッフ分析(MD-4)の集計サービス
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面④
 *     「3名カード(順位/合計/平均比較なし)」「売上単体表示を型で禁止」
 *   - ユーザー指示(2026-06-23): 表示は売上/指名率/リピート率/LTV/成長率の5項目のみ。
 *     ランキング禁止・順位表示禁止・売上単体比較禁止。
 *   - ユーザー指示(2026-07-26): 表示順は五十音順ではなく固定順
 *     (鈴木→亀山→外舘→久保田・久保田は最後固定。売上順・ID順は禁止)。
 *     src/lib/staffOrder.tsのcompareStaffOrder()に順序を集約。
 *   - ユーザー指示(2026-08-01・PHASE STAFFANALYTICS-TOTAL): 表示項目を
 *     売上/店販売上/指名率/リピート率/客単価の5項目へ統一(来店人数・LTVは削除)。
 *     LTVはこのスタッフ分析専用の算出だった(担当顧客のLTV平均・MD-3のCustomerAssetEngineとは
 *     別実装)ため、削除しても他画面(MD-3顧客資産・My Page)には影響しない。
 *     LTV算出専用だったsubscriptions(継続中サブスクMRR)もこの画面では不要になったため、
 *     入力から削除する(brain_subscriptionsの集計自体はMD-3側でCustomerAssetEngineが継続担当)。
 *     「合計」行を新設。個別スタッフ行と同じ集計関数を「担当スタッフで絞り込まない全visits」に
 *     適用するだけで、氏名判定・新規テーブル・新規APIを使わずに全スタッフ合算値を算出する
 *     (指名率・リピート率・客単価は単純平均ではなく、全件ベースの正しい加重値になる)。
 *
 * brain_staff/brain_visitsをその場で集計する
 * (DashboardAggregator/ChurnRiskEngineと同じくライブ集計・決定論ルール・LLM/AI不使用)。
 */
import type { Staff, Visit } from '../../types/riora.types';
import { compareStaffOrder } from '../staffOrder';

export interface StaffAnalyticsRow {
  staffId: string;
  staffName: string;
  /** 当月(月初〜asOfDate)の売上(このスタッフが担当した来店のtreatment+retail合計)。 */
  monthlySales: number;
  /** 当月(月初〜asOfDate)の店販売上(このスタッフが担当した来店のretail_amount合計)。 */
  retailSales: number;
  /** 当月(月初〜asOfDate)にこのスタッフが担当した来店のユニーク顧客数(件数ではなく人数。経営TOPの来店人数と同じ定義。SA-2)。 */
  visitCount: number;
  /** 客単価 = monthlySales ÷ visitCount。visitCount=0の場合はnull(SA-2)。 */
  avgSpend: number | null;
  /** 全履歴のうちこのスタッフが担当した来店の指名率。担当来店0件はnull。 */
  nominationRate: number | null;
  /** 全履歴のうちこのスタッフが担当した来店のリピート率(visit_count_at>1の割合)。担当来店0件はnull。 */
  repeatRate: number | null;
  /** 前月比成長率((当月MTD売上−前月売上)÷前月売上)。前月売上0または前月データ無しはnull。 */
  growthRate: number | null;
}

export interface ComputeStaffAnalyticsInput {
  /** 集計基準日(YYYY-MM-DD)。通常は本日。 */
  asOfDate: string;
  staff: Staff[];
  visits: Visit[];
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

function sumRetailSales(visits: Visit[]): number {
  return visits.reduce((sum, v) => sum + v.retailAmount, 0);
}

/**
 * 担当来店の集合(handledVisits)から5指標(売上/店販売上/指名率/リピート率/客単価)+成長率を
 * 算出する共通ロジック。個別スタッフ行・合計行のどちらも、絞り込む対象のvisitsが違うだけで
 * 同じ関数を通す(PHASE STAFFANALYTICS-TOTAL)。これにより指名率・リピート率・客単価の
 * 合計値は単純平均ではなく全件ベースの正しい加重値になる。
 */
function computeMetrics(handledVisits: Visit[], curStart: string, asOfDate: string, prevStart: string, prevEnd: string) {
  const monthVisits = handledVisits.filter((v) => v.visitDate >= curStart && v.visitDate <= asOfDate);
  const visitCount = new Set(monthVisits.map((v) => v.customerId)).size;

  const monthlySales = sumSales(monthVisits);
  const retailSales = sumRetailSales(monthVisits);
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

  return { monthlySales, retailSales, visitCount, avgSpend, nominationRate, repeatRate, growthRate };
}

/** DB/Supabaseに依存しない純粋関数。五十音順(近似)で返す。ランキング・順位は一切持たない。 */
export function computeStaffAnalytics(input: ComputeStaffAnalyticsInput): StaffAnalyticsRow[] {
  const { asOfDate, staff, visits } = input;

  const { start: curStart } = monthRange(asOfDate);
  const { start: prevStart, end: prevEnd } = previousMonthRange(asOfDate);

  const rows: StaffAnalyticsRow[] = staff.map((s) => {
    const handledVisits = visits.filter((v) => v.staffId === s.id);
    const metrics = computeMetrics(handledVisits, curStart, asOfDate, prevStart, prevEnd);

    return {
      staffId: s.id,
      staffName: s.name,
      ...metrics,
    };
  });

  // 管理者ダッシュボード各画面の表示順を固定する(鈴木→亀山→外舘→久保田・ユーザー指示2026-07-26)。
  return rows.sort((a, b) => compareStaffOrder(a.staffName, b.staffName));
}

export interface StaffAnalyticsTotal {
  monthlySales: number;
  retailSales: number;
  visitCount: number;
  avgSpend: number | null;
  nominationRate: number | null;
  repeatRate: number | null;
  growthRate: number | null;
}

/**
 * 全スタッフ合算(合計行)。担当スタッフで絞り込まずvisits全件をcomputeMetrics()に通すだけで、
 * staff_idにも氏名にも依存せず正しい加重値を算出する(PHASE STAFFANALYTICS-TOTAL)。
 */
export function computeStaffAnalyticsTotal(input: ComputeStaffAnalyticsInput): StaffAnalyticsTotal {
  const { asOfDate, visits } = input;
  const { start: curStart } = monthRange(asOfDate);
  const { start: prevStart, end: prevEnd } = previousMonthRange(asOfDate);
  return computeMetrics(visits, curStart, asOfDate, prevStart, prevEnd);
}

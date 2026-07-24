/**
 * MenuAnalyticsEngine.ts — メニュー画面の集計サービス
 *
 * brain_menus/brain_visitsをその場で集計する(CustomerAssetEngineと同じく
 * ライブ集計・決定論ルール・LLM/AI不使用)。
 *
 * Phase 1-G: summary.repeatRate(店舗全体の90日以内リピート率)は
 * src/lib/analytics/repeatRateWithin.ts(元DashboardAggregator.ts、経営TOPの
 * repeat_90と同一定義)を再利用して算出する。メニュー行ごとのrepeatRate
 * (MenuAnalyticsRow.repeatRate)は今回のスコープ外のため引き続きnull固定。
 *
 * 実データソースが存在しない指標(repeatRate(行別)/profitMargin/aiRecommendRate/
 * upsellSuccessRate/vipConversionRate)はnull固定で返す。呼び出し側(UI)は
 * nullを「集計準備中/未実装」として表示すること(数値の推測・ダミー埋めは禁止)。
 */
import type { Menu, Visit } from '../../types/riora.types';
import { repeatRateWithin, groupVisitsByCustomer } from '../analytics/repeatRateWithin';

/** 店舗全体リピート率の判定日数(経営TOPダッシュボードの90日リピート率と同一定義)。 */
const STORE_REPEAT_RATE_WINDOW_DAYS = 90;

export interface MenuAnalyticsRow {
  id: string;
  name: string;
  price: number;
  role: Menu['role'];
  targetTypes: Menu['targetTypes'];
  /** 今月(visit_dateが基準日と同年同月)の来店件数。 */
  monthlyCount: number;
  /** 今月のtreatment_amount合計。 */
  monthlyRevenue: number;
  /** 全期間の来店件数。 */
  totalVisitCount: number;
  /** 全期間のうちnext_booking_made=trueの割合(0〜100・小数なし)。来店0件はnull。 */
  nextVisitRate: number | null;
  // ── 実データソースが存在しない指標(将来の設計書実装まで固定でnull) ──
  repeatRate: null;
  profitMargin: null;
  aiRecommendRate: null;
  upsellSuccessRate: null;
  vipConversionRate: null;
}

export interface DailyRevenuePoint {
  date: string;
  revenue: number;
}

export interface MenuAnalyticsSummary {
  totalMenuCount: number;
  monthlyRevenueTotal: number;
  lastMonthRevenueTotal: number;
  /** 今月対前月の売上変化率(%)。前月の実績が0件の場合は比較不能のためnull。 */
  momRevenueChangePct: number | null;
  /** 基準日を含む直近7日間の日別売上(古い日付順)。 */
  dailyRevenueLast7Days: DailyRevenuePoint[];
  /**
   * 店舗全体の90日以内リピート率(0〜100・小数なし、Phase 1-G)。
   * 経営TOPダッシュボードのrepeat_90と同一定義(今月来店のうち、直前来店から
   * 90日以内だった割合。初回来店は分母から除外)。対象来店が0件の場合はnull。
   */
  repeatRate: number | null;
}

export interface ComputeMenuAnalyticsInput {
  menus: Menu[];
  visits: Visit[];
  /** 集計基準日(省略時は呼び出し時点のサーバー現在日時)。テスト時に固定するため注入可能にする。 */
  today?: Date;
}

export interface ComputeMenuAnalyticsResult {
  menus: MenuAnalyticsRow[];
  summary: MenuAnalyticsSummary;
}

// 日付計算はすべてUTC基準(タイムゾーン差によるズレを防ぐ)。visit_dateはYYYY-MM-DD文字列のため
// 文字列のままprefix比較する(Date変換を経由しない)。

function monthPrefix(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

function previousMonthPrefix(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return monthPrefix(d);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** DB/Supabaseに依存しない純粋関数。menusの並び順を保持して返す。 */
export function computeMenuAnalytics(input: ComputeMenuAnalyticsInput): ComputeMenuAnalyticsResult {
  const { menus, visits } = input;
  const today = input.today ?? new Date();
  const thisMonth = monthPrefix(today);
  const lastMonth = previousMonthPrefix(today);

  const visitsByMenu = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = visitsByMenu.get(v.menuId) ?? [];
    list.push(v);
    visitsByMenu.set(v.menuId, list);
  }

  const menuRows: MenuAnalyticsRow[] = menus.map((menu) => {
    const menuVisits = visitsByMenu.get(menu.id) ?? [];
    const monthlyVisits = menuVisits.filter((v) => v.visitDate.slice(0, 7) === thisMonth);

    const totalVisitCount = menuVisits.length;
    const nextVisitRate = totalVisitCount > 0
      ? Math.round((menuVisits.filter((v) => v.nextBookingMade).length / totalVisitCount) * 100)
      : null;

    return {
      id: menu.id,
      name: menu.name,
      price: menu.price,
      role: menu.role,
      targetTypes: menu.targetTypes,
      monthlyCount: monthlyVisits.length,
      monthlyRevenue: monthlyVisits.reduce((sum, v) => sum + v.treatmentAmount, 0),
      totalVisitCount,
      nextVisitRate,
      repeatRate: null,
      profitMargin: null,
      aiRecommendRate: null,
      upsellSuccessRate: null,
      vipConversionRate: null,
    };
  });

  const monthlyRevenueTotal = visits
    .filter((v) => v.visitDate.slice(0, 7) === thisMonth)
    .reduce((sum, v) => sum + v.treatmentAmount, 0);
  const lastMonthRevenueTotal = visits
    .filter((v) => v.visitDate.slice(0, 7) === lastMonth)
    .reduce((sum, v) => sum + v.treatmentAmount, 0);
  const momRevenueChangePct = lastMonthRevenueTotal > 0
    ? Math.round(((monthlyRevenueTotal - lastMonthRevenueTotal) / lastMonthRevenueTotal) * 100)
    : null;

  const dailyRevenueLast7Days: DailyRevenuePoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const dateStr = toDateOnly(d);
    const revenue = visits
      .filter((v) => v.visitDate.slice(0, 10) === dateStr)
      .reduce((sum, v) => sum + v.treatmentAmount, 0);
    dailyRevenueLast7Days.push({ date: dateStr, revenue });
  }

  // Phase 1-G: 店舗全体の90日以内リピート率(経営TOPのrepeat_90と同一定義・同一関数)。
  // visitsByCustomerは全履歴(月をまたいだ直前来店探索のため)、対象はメニュー問わず今月の全来店。
  const monthlyVisitsAllMenus = visits.filter((v) => v.visitDate.slice(0, 7) === thisMonth);
  const visitsByCustomer = groupVisitsByCustomer(visits);
  const repeatRate = (() => {
    const rate = repeatRateWithin(monthlyVisitsAllMenus, visitsByCustomer, STORE_REPEAT_RATE_WINDOW_DAYS);
    return rate === null ? null : Math.round(rate * 100);
  })();

  return {
    menus: menuRows,
    summary: {
      totalMenuCount: menus.length,
      monthlyRevenueTotal,
      lastMonthRevenueTotal,
      momRevenueChangePct,
      dailyRevenueLast7Days,
      repeatRate,
    },
  };
}
